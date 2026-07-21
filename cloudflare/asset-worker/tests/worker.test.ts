import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  decodeManifest,
  encodeManifest,
  parseManifest,
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

const TEST_COORDINATOR_URL =
  'https://test-project.supabase.co/functions/v1/coordinate-pdf-upload-worker'

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
  failNextConditionalKey: string | null = null
  failNextDeleteKey: string | null = null
  getCalls: string[] = []
  listPageSize: number | null = null
  pauseNextPutKey: string | null = null
  pausedPutGate: Promise<void> | null = null
  pausedPutMarkStarted: (() => void) | null = null
  pausedPutRelease: (() => void) | null = null
  pausedPutStarted: Promise<void> | null = null

  pauseNextPut(key: string) {
    let markStarted!: () => void
    let release!: () => void
    this.pauseNextPutKey = key
    this.pausedPutStarted = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    this.pausedPutGate = new Promise<void>((resolve) => {
      release = resolve
    })
    this.pausedPutMarkStarted = markStarted
    this.pausedPutRelease = release
    return {
      release,
      started: this.pausedPutStarted,
    }
  }

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
    if (this.pauseNextPutKey === key && this.pausedPutGate) {
      this.pauseNextPutKey = null
      const gate = this.pausedPutGate
      this.pausedPutStarted = null
      this.pausedPutMarkStarted?.()
      this.pausedPutMarkStarted = null
      await gate
      this.pausedPutGate = null
      this.pausedPutRelease = null
    }
    const existing = this.objects.get(key)
    if (
      (this.failNextConditional || this.failNextConditionalKey === key) &&
      options?.onlyIf?.etagMatches
    ) {
      this.failNextConditional = false
      this.failNextConditionalKey = null
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
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)))
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

type WorkerFixture = Awaited<ReturnType<typeof fixture>>

function enablePdfPublicationEnvironment(
  value: WorkerFixture,
  coordinatorUrl = TEST_COORDINATOR_URL,
) {
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL: coordinatorUrl,
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
}

async function seedPublicationLedger(
  value: WorkerFixture,
  input: {
    bytes: number
    documentId: string
    generation: number
    manifestEtag?: string
    manifestVersion?: number
    objectKey: string
    pdfSha256: string
    previousAccessVersion?: number
    previousDocumentVersions?: string[]
    publicationId: string
    status:
      | 'active'
      | 'activating'
      | 'committed'
      | 'receiving'
      | 'rolled_back'
      | 'uploaded'
    targetAccessVersion?: number
    ticketJti: string
  },
) {
  await value.r2.put(
    `publication-ledger/${input.publicationId}.json`,
    `${JSON.stringify({
      bytes: input.bytes,
      createdAt: new Date(value.now * 1000).toISOString(),
      documentId: input.documentId,
      generation: input.generation,
      lecturePublicId: value.lecture,
      manifestEtag: input.manifestEtag,
      manifestVersion: input.manifestVersion,
      objectKey: input.objectKey,
      pdfSha256: input.pdfSha256,
      previousAccessVersion: input.previousAccessVersion,
      previousDocumentVersions: input.previousDocumentVersions,
      publicationId: input.publicationId,
      status: input.status,
      targetAccessVersion: input.targetAccessVersion,
      ticketJti: input.ticketJti,
      updatedAt: new Date(value.now * 1000).toISOString(),
    })}\n`,
  )
}

async function createUploadTicket(
  value: WorkerFixture,
  input: {
    bytes: number
    documentId: string
    generation: number
    jti: string
    nonce: string
    pdfSha256: string
    publicationId: string
  },
) {
  return createPublicationToken(value.keys.privateKey, {
    aud: 'compass-pdf-publication-worker',
    bytes: input.bytes,
    doc: input.documentId,
    exp: value.now + 300,
    gen: input.generation,
    iat: value.now,
    iss: 'compass-supabase',
    jti: input.jti,
    lec: value.lecture,
    nbf: value.now - 1,
    nonce: input.nonce,
    origin: 'https://compass.example',
    pub: input.publicationId,
    purpose: 'upload',
    sha: input.pdfSha256,
    sid: '79000000-0000-4000-8000-000000000726',
  })
}

async function readPublicationLedger(
  value: WorkerFixture,
  publicationId: string,
) {
  const object = await value.r2.get(`publication-ledger/${publicationId}.json`)
  assert.ok(object)
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(await object.arrayBuffer!())),
  ) as Record<string, unknown>
}

function singleCleanupFetcher(
  job: Record<string, unknown>,
  completions: Array<Record<string, unknown>>,
) {
  let available = true
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (body.action === 'claimCleanup') {
      const data = available ? [job] : []
      available = false
      return Response.json({ data, ok: true })
    }
    completions.push(body)
    return Response.json({ ok: true })
  }) as typeof fetch
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

test('retention cleanup charges a manifest conflict for every attempted due document', async () => {
  const value = await fixture()
  const dueTime = new Date((value.now - 1) * 1000).toISOString()
  const archiveTime = new Date(
    (value.now - 7 * 86400 - 1) * 1000,
  ).toISOString()
  value.manifest.documents = Array.from({ length: 4 }, (_, index) => {
    const documentId = `doc-${index + 1}`
    const documentVersion = String(index + 1).repeat(64)
    return {
      ...value.manifest.documents[0]!,
      archive_expires_at: archiveTime,
      delete_after: dueTime,
      document_id: documentId,
      document_version: documentVersion,
      object_key: `pdf/${value.lecture}/${documentId}/${documentVersion}.pdf`,
      pdf_sha256: documentVersion,
    }
  })
  const manifestKey = `manifests/${value.lecture}/manifest.json`
  await value.r2.put(manifestKey, encodeManifest(value.manifest))
  value.r2.failNextConditional = true

  const result = await cleanupExpiredDocuments(
    value.env,
    new Date(value.now * 1000),
    3,
  )

  assert.equal(result.conflicts, 3)
  assert.equal(result.processed, 0)
  assert.equal(
    [...value.r2.objects.keys()].some((key) =>
      key.startsWith('cleanup-pending/'),
    ),
    false,
  )
  const unchanged = await value.r2.get(manifestKey)
  assert.ok(unchanged)
  assert.equal(
    decodeManifest(new Uint8Array(await unchanged.arrayBuffer!())).documents
      .length,
    4,
  )
})

test('retention cleanup recovers distinct intents for equal hashes at different object keys', async () => {
  const value = await fixture()
  const dueTime = new Date((value.now - 1) * 1000).toISOString()
  const archiveTime = new Date(
    (value.now - 7 * 86400 - 1) * 1000,
  ).toISOString()
  const documentVersion = '9'.repeat(64)
  const documents = ['same-hash-a', 'same-hash-b'].map((documentId) => ({
    ...value.manifest.documents[0]!,
    archive_expires_at: archiveTime,
    delete_after: dueTime,
    document_id: documentId,
    document_version: documentVersion,
    object_key: `pdf/${value.lecture}/${documentId}/${documentVersion}.pdf`,
    pdf_sha256: documentVersion,
  }))
  value.manifest.documents = documents
  const manifestKey = `manifests/${value.lecture}/manifest.json`
  await value.r2.put(manifestKey, encodeManifest(value.manifest))
  for (const document of documents) {
    await value.r2.put(document.object_key, '%PDF-1.7\nlegacy')
  }
  value.r2.failNextDeleteKey = documents[0]!.object_key

  await assert.rejects(
    cleanupExpiredDocuments(value.env, new Date(value.now * 1000), 2),
    /simulated delete interruption/,
  )
  assert.equal(
    [...value.r2.objects.keys()].filter((key) =>
      key.startsWith('cleanup-pending/v2/'),
    ).length,
    2,
  )
  const committed = await value.r2.get(manifestKey)
  assert.ok(committed)
  assert.equal(
    decodeManifest(new Uint8Array(await committed.arrayBuffer!())).documents
      .length,
    0,
  )

  const recovered = await cleanupExpiredDocuments(
    value.env,
    new Date((value.now + 1) * 1000),
    2,
  )
  assert.equal(recovered.processed, 2)
  assert.equal(recovered.deleted, 2)
  for (const document of documents) {
    assert.equal(await value.r2.head(document.object_key), null)
  }
  assert.equal(
    [...value.r2.objects.keys()].some((key) =>
      key.startsWith('cleanup-pending/'),
    ),
    false,
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
    PDF_PUBLICATION_COORDINATOR_URL: TEST_COORDINATOR_URL,
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
    PDF_PUBLICATION_COORDINATOR_URL: TEST_COORDINATOR_URL,
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
  let nonceClaimed = false
  let successfulNonceClaims = 0
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { action: string }
    if (body.action === 'claimNonce') {
      if (nonceClaimed) {
        return Response.json(
          { message: 'nonce already claimed', ok: false },
          {
            status: 409,
          },
        )
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
    PDF_PUBLICATION_COORDINATOR_URL: TEST_COORDINATOR_URL,
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
  const collisionKey = `pdf/${value.lecture}/integrity-material/${sha}/${collisionPublicationId}.pdf`
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
    PDF_PUBLICATION_COORDINATOR_URL: TEST_COORDINATOR_URL,
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
    PDF_PUBLICATION_COORDINATOR_URL: TEST_COORDINATOR_URL,
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
  const activeManifestObject = await value.r2.get(
    `manifests/${value.lecture}/manifest.json`,
  )
  assert.ok(activeManifestObject)
  const activeManifestBytes = new Uint8Array(
    await activeManifestObject.arrayBuffer!(),
  )
  const activeManifest = decodeManifest(activeManifestBytes)
  await value.r2.put(
    `manifests/${value.lecture}/manifest.json`,
    encodeManifest({
      ...activeManifest,
      documents: [
        ...activeManifest.documents,
        {
          archive_expires_at: null,
          byte_size: 11,
          delete_after: null,
          display_name: 'Unexpected same-document writer',
          document_id: 'browser-material',
          document_version: '1'.repeat(64),
          download_enabled: false,
          object_key: `pdf/${value.lecture}/browser-material/${'1'.repeat(64)}.pdf`,
          page_count: 1,
          pdf_sha256: '1'.repeat(64),
          text_char_count: 1,
          text_sha256: '2'.repeat(64),
          visible: true,
        },
      ],
      manifest_version: activeManifest.manifest_version + 1,
      updated_at: new Date((value.now + 1) * 1000).toISOString(),
    }),
  )
  const crossPathConflict = await worker.fetch(
    new Request(
      `https://pdf.example/v2/pdf-publications/${publicationId}/rollback`,
      {
        headers: { Authorization: `Bearer ${rollbackToken}` },
        method: 'POST',
      },
    ),
    value.env,
  )
  assert.equal(crossPathConflict.status, 409)
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'active',
    'an unexpected visible same-document writer fences rollback',
  )
  await value.r2.put(
    `manifests/${value.lecture}/manifest.json`,
    activeManifestBytes,
  )
  value.r2.failNextConditionalKey =
    `publication-ledger/${publicationId}.json`
  const interruptedRollback = await worker.fetch(
    new Request(
      `https://pdf.example/v2/pdf-publications/${publicationId}/rollback`,
      {
        headers: { Authorization: `Bearer ${rollbackToken}` },
        method: 'POST',
      },
    ),
    value.env,
  )
  assert.equal(interruptedRollback.status, 409)
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'active',
    'a lost ledger CAS must not be reported as a completed rollback',
  )
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
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'rolled_back',
  )
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
    PDF_PUBLICATION_COORDINATOR_URL: TEST_COORDINATOR_URL,
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
  const actions: string[] = []
  const worker = createAssetWorker(() => new Date(value.now * 1000), (async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body)) as { action: string }
    actions.push(body.action)
    return Response.json({ ok: true, status: body.action })
  }) as typeof fetch)
  const publicationId = '78500000-0000-4000-8000-000000000726'
  const attemptId = '78600000-0000-4000-8000-000000000726'
  const pdf = new TextEncoder().encode('%PDF-1.7\nrecover')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/recover-material/${sha}/${publicationId}.pdf`
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
  assert.equal(
    ((await response.json()) as { status: string }).status,
    'uploaded',
  )
  assert.deepEqual(actions, ['recordUploaded'])
  const ledger = await value.r2.get(`publication-ledger/${publicationId}.json`)
  assert.ok(ledger)
  assert.equal(
    JSON.parse(
      new TextDecoder().decode(new Uint8Array(await ledger.arrayBuffer!())),
    ).status,
    'uploaded',
  )
})

test('committed hidden publication without activation binding uses normal terminal cleanup', async () => {
  const value = await fixture()
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL: TEST_COORDINATOR_URL,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'false',
  })
  const publicationId = '78800000-0000-4000-8000-000000000726'
  const cleanupClaimId = '78900000-0000-4000-8000-000000000726'
  const sha = 'e'.repeat(64)
  const objectKey = `pdf/${value.lecture}/cleanup-material/${sha}/${publicationId}.pdf`
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
      previousAccessVersion: 1,
      previousDocumentVersions: [],
      status: 'committed',
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
  let remainingClaims = 2
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (body.action === 'claimCleanup') {
      const data = remainingClaims > 0
        ? [
            {
              activation_operation_id: null,
              activation_target_access_version: null,
              cleanup_binding_version: 1,
              cleanup_claim_id: cleanupClaimId,
              cleanup_worker_generation: 1,
              committed_manifest_access_version: 1,
              committed_manifest_etag: 'hidden-etag-2',
              committed_manifest_version: 2,
              document_id: 'cleanup-material',
              expected_byte_size: pdf.byteLength,
              expected_pdf_sha256: sha,
              lecture_public_id: value.lecture,
              object_key: objectKey,
              pdf_access_version: 1,
              publication_id: publicationId,
              state: 'expired',
            },
          ]
        : []
      remainingClaims -= 1
      return Response.json({ data, ok: true })
    }
    completions.push(body)
    return Response.json({ ok: true })
  }) as typeof fetch

  const quiescing = await cleanupExpiredPdfPublications(
    value.env,
    new Date(value.now * 1000),
    25,
    fetcher,
  )
  assert.equal(quiescing.failures, 1)
  assert.equal(completions.at(-1)?.errorCode, 'cleanup_quiescence_pending')
  assert.ok(value.r2.objects.has(objectKey))

  const result = await cleanupExpiredPdfPublications(
    value.env,
    new Date((value.now + 601) * 1000),
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
  assert.equal(value.r2.objects.has(objectKey), true)
  assert.equal(
    value.r2.objects.has(`publication-ledger/${publicationId}.json`),
    true,
  )
  assert.equal(
    (await value.r2.head(objectKey))?.customMetadata
      ?.compassCleanupTombstone,
    'v1',
  )
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'cleanup_complete',
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
  assert.equal(completions.length, 2)
  assert.equal(completions[0]?.succeeded, false)
  assert.equal(completions[1]?.succeeded, true)

  const repeated = await cleanupExpiredPdfPublications(
    value.env,
    new Date(value.now * 1000),
    25,
    fetcher,
  )
  assert.equal(repeated.scanned, 0)
})

test('reissued PDF upload replaces a stale receiving ledger and rejects the old generation', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '78b00000-0000-4000-8000-000000000726'
  const oldAttemptId = '78c00000-0000-4000-8000-000000000726'
  const newAttemptId = '78d00000-0000-4000-8000-000000000726'
  const documentId = 'stale-reissue-material'
  const pdf = new TextEncoder().encode('%PDF-1.7\nstale-reissue')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    objectKey,
    pdfSha256: sha,
    publicationId,
    status: 'receiving',
    ticketJti: oldAttemptId,
  })
  const actions: string[] = []
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { action: string }
    actions.push(body.action)
    return Response.json({ ok: true, status: body.action })
  }) as typeof fetch
  const worker = createAssetWorker(() => new Date(value.now * 1000), fetcher)
  const newTicket = await createUploadTicket(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 2,
    jti: newAttemptId,
    nonce: 'R'.repeat(43),
    pdfSha256: sha,
    publicationId,
  })
  const upload = await worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: pdf,
      headers: {
        Authorization: `Bearer ${newTicket}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://compass.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  assert.equal(upload.status, 201)
  assert.deepEqual(actions, ['claimNonce', 'recordUploaded'])
  const ledger = await readPublicationLedger(value, publicationId)
  assert.equal(ledger.generation, 2)
  assert.equal(ledger.ticketJti, newAttemptId)
  assert.equal(ledger.status, 'uploaded')
  assert.ok(await value.r2.head(objectKey))

  const oldTicket = await createUploadTicket(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    jti: oldAttemptId,
    nonce: 'Q'.repeat(43),
    pdfSha256: sha,
    publicationId,
  })
  const replay = await worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: pdf,
      headers: {
        Authorization: `Bearer ${oldTicket}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://compass.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  assert.equal(replay.status, 409)
  assert.deepEqual(actions, ['claimNonce', 'recordUploaded'])
})

test('reissued PDF upload adopts an exact object left by a crashed attempt without reading replacement bytes', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '78e00000-0000-4000-8000-000000000726'
  const documentId = 'stale-object-material'
  const pdf = new TextEncoder().encode('%PDF-1.7\nstale-object')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    objectKey,
    pdfSha256: sha,
    publicationId,
    status: 'receiving',
    ticketJti: '78f00000-0000-4000-8000-000000000726',
  })
  await value.r2.put(objectKey, pdf, { sha256: sha })
  const actions: string[] = []
  const worker = createAssetWorker(() => new Date(value.now * 1000), (async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body)) as { action: string }
    actions.push(body.action)
    return Response.json({ ok: true, status: body.action })
  }) as typeof fetch)
  const ticket = await createUploadTicket(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 2,
    jti: '79100000-0000-4000-8000-000000000726',
    nonce: 'S'.repeat(43),
    pdfSha256: sha,
    publicationId,
  })
  const untrustedReplacement = new Uint8Array(pdf.byteLength).fill(0x58)
  const response = await worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: untrustedReplacement,
      headers: {
        Authorization: `Bearer ${ticket}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://compass.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(actions, ['claimNonce', 'recordUploaded'])
  const stored = await value.r2.get(objectKey)
  assert.ok(stored)
  assert.deepEqual(
    new Uint8Array(await stored.arrayBuffer!()),
    pdf,
    'the immutable verified object wins over retry request bytes',
  )
  const ledger = await readPublicationLedger(value, publicationId)
  assert.equal(ledger.generation, 2)
  assert.equal(ledger.status, 'uploaded')
})

test('stale receiving-ledger CAS conflict is fail-closed and the same reissue can retry', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '79200000-0000-4000-8000-000000000726'
  const documentId = 'stale-cas-material'
  const pdf = new TextEncoder().encode('%PDF-1.7\nstale-cas')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    objectKey,
    pdfSha256: sha,
    publicationId,
    status: 'receiving',
    ticketJti: '79300000-0000-4000-8000-000000000726',
  })
  const actions: string[] = []
  const worker = createAssetWorker(() => new Date(value.now * 1000), (async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body)) as { action: string }
    actions.push(body.action)
    return Response.json({ ok: true, status: body.action })
  }) as typeof fetch)
  const ticket = await createUploadTicket(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 2,
    jti: '79400000-0000-4000-8000-000000000726',
    nonce: 'T'.repeat(43),
    pdfSha256: sha,
    publicationId,
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
  value.r2.failNextConditional = true
  const conflicted = await upload()
  assert.equal(conflicted.status, 409)
  assert.equal(
    (await readPublicationLedger(value, publicationId)).generation,
    1,
  )
  assert.equal(await value.r2.head(objectKey), null)

  const retried = await upload()
  assert.equal(retried.status, 201)
  assert.deepEqual(actions, ['claimNonce', 'claimNonce', 'recordUploaded'])
  const ledger = await readPublicationLedger(value, publicationId)
  assert.equal(ledger.generation, 2)
  assert.equal(ledger.status, 'uploaded')
})

test('stale-generation recovery never replaces a ledger with changed immutable binding', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '79c00000-0000-4000-8000-000000000726'
  const documentId = 'bound-stale-material'
  const pdf = new TextEncoder().encode('%PDF-1.7\nbound-stale')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    objectKey,
    pdfSha256: sha,
    publicationId,
    status: 'receiving',
    ticketJti: '79d00000-0000-4000-8000-000000000726',
  })
  let coordinatorCalls = 0
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    (async () => {
      coordinatorCalls += 1
      return Response.json({ ok: true })
    }) as typeof fetch,
  )
  const ticket = await createUploadTicket(value, {
    bytes: pdf.byteLength,
    documentId: 'changed-document-binding',
    generation: 2,
    jti: '79e00000-0000-4000-8000-000000000726',
    nonce: 'U'.repeat(43),
    pdfSha256: sha,
    publicationId,
  })
  const response = await worker.fetch(
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
  assert.equal(response.status, 409)
  assert.equal(coordinatorCalls, 0)
  const ledger = await readPublicationLedger(value, publicationId)
  assert.equal(ledger.generation, 1)
  assert.equal(ledger.documentId, documentId)
  assert.equal(await value.r2.head(objectKey), null)
})

async function createRetiredCleanupScenario(
  visibility: 'absent' | 'hidden' | 'visible',
) {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '79500000-0000-4000-8000-000000000726'
  const documentId = 'retired-browser-material'
  const pdf = new TextEncoder().encode('%PDF-1.7\nretired')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    objectKey,
    pdfSha256: sha,
    publicationId,
    status: 'active',
    ticketJti: '79600000-0000-4000-8000-000000000726',
  })
  if (visibility !== 'absent') {
    await value.r2.put(objectKey, pdf, { sha256: sha })
    await value.r2.put(
      `manifests/${value.lecture}/manifest.json`,
      encodeManifest({
        ...value.manifest,
        documents: [
          ...value.manifest.documents,
          {
            archive_expires_at: new Date(value.now * 1000).toISOString(),
            byte_size: pdf.byteLength,
            delete_after: new Date(value.now * 1000).toISOString(),
            display_name: 'Retired browser material',
            document_id: documentId,
            document_version: sha,
            download_enabled: true,
            object_key: objectKey,
            page_count: 1,
            pdf_sha256: sha,
            text_char_count: 1,
            text_sha256: '9'.repeat(64),
            visible: visibility === 'visible',
          },
        ],
        manifest_version: value.manifest.manifest_version + 1,
      }),
    )
  }
  const completions: Array<Record<string, unknown>> = []
  const makeFetcher = (cleanupClaimId: string) => {
    let available = true
    return (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (body.action === 'claimCleanup') {
        const data = available
          ? [
              {
                activation_operation_id: null,
                activation_target_access_version: null,
                cleanup_binding_version: 1,
                cleanup_claim_id: cleanupClaimId,
                cleanup_worker_generation: 1,
                committed_manifest_access_version: null,
                committed_manifest_etag: null,
                committed_manifest_version: null,
                document_id: documentId,
                expected_byte_size: pdf.byteLength,
                expected_pdf_sha256: sha,
                lecture_public_id: value.lecture,
                object_key: objectKey,
                pdf_access_version: 1,
                publication_id: publicationId,
                state: 'retired',
              },
            ]
          : []
        available = false
        return Response.json({ data, ok: true })
      }
      completions.push(body)
      return Response.json({ ok: true })
    }) as typeof fetch
  }
  return {
    completions,
    documentId,
    makeFetcher,
    objectKey,
    publicationId,
    value,
  }
}

test('retired DB publication cleans an active Worker ledger only after its manifest reference is hidden', async () => {
  const scenario = await createRetiredCleanupScenario('hidden')
  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('79700000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)
  assert.equal(
    scenario.completions.at(-1)?.errorCode,
    'cleanup_quiescence_pending',
  )
  const result = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('79710000-0000-4000-8000-000000000726'),
  )
  assert.deepEqual(result, {
    deletedLedgers: 1,
    deletedObjects: 1,
    failures: 0,
    scanned: 1,
    skipped: false,
  })
  assert.equal(
    (await scenario.value.r2.head(scenario.objectKey))?.customMetadata
      ?.compassCleanupTombstone,
    'v1',
  )
  assert.equal(
    (
      await readPublicationLedger(
        scenario.value,
        scenario.publicationId,
      )
    ).status,
    'cleanup_complete',
  )
  const manifestObject = await scenario.value.r2.get(
    `manifests/${scenario.value.lecture}/manifest.json`,
  )
  assert.ok(manifestObject)
  const manifest = decodeManifest(
    new Uint8Array(await manifestObject.arrayBuffer!()),
  )
  assert.equal(
    manifest.documents.some(
      (document) => document.object_key === scenario.objectKey,
    ),
    false,
  )
  assert.equal(
    manifest.documents.some(
      (document) => document.document_id === 'doc-main' && document.visible,
    ),
    true,
  )
  assert.equal(scenario.completions.at(-1)?.succeeded, true)
})

test('retired cleanup converges when document retention already removed the object and manifest reference', async () => {
  const scenario = await createRetiredCleanupScenario('absent')
  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('79800000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)
  const result = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('79810000-0000-4000-8000-000000000726'),
  )
  assert.equal(result.failures, 0)
  assert.equal(result.deletedObjects, 0)
  assert.equal(result.deletedLedgers, 1)
  assert.equal(scenario.completions.at(-1)?.succeeded, true)
})

test('retired cleanup preserves an active ledger and object while its exact manifest reference is visible', async () => {
  const scenario = await createRetiredCleanupScenario('visible')
  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('79900000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)
  const result = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('79910000-0000-4000-8000-000000000726'),
  )
  assert.equal(result.failures, 1)
  assert.equal(result.deletedObjects, 0)
  assert.equal(result.deletedLedgers, 0)
  assert.ok(await scenario.value.r2.head(scenario.objectKey))
  assert.ok(
    await scenario.value.r2.head(
      `publication-ledger/${scenario.publicationId}.json`,
    ),
  )
  assert.equal(scenario.completions.at(-1)?.succeeded, false)
  assert.equal(
    scenario.completions.at(-1)?.errorCode,
    'cleanup_object_still_visible',
  )
})

test('retired cleanup preserves bytes on manifest CAS conflict and a new DB lease can retry', async () => {
  const scenario = await createRetiredCleanupScenario('hidden')
  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('79a00000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)
  scenario.value.r2.failNextConditional = true
  const conflicted = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('79a10000-0000-4000-8000-000000000726'),
  )
  assert.equal(conflicted.failures, 1)
  assert.ok(await scenario.value.r2.head(scenario.objectKey))
  assert.ok(
    await scenario.value.r2.head(
      `publication-ledger/${scenario.publicationId}.json`,
    ),
  )
  assert.equal(
    scenario.completions.at(-1)?.errorCode,
    'cleanup_manifest_conflict',
  )

  const retried = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 602) * 1000),
    25,
    scenario.makeFetcher('79b00000-0000-4000-8000-000000000726'),
  )
  assert.equal(retried.failures, 0)
  assert.equal(retried.deletedObjects, 1)
  assert.equal(retried.deletedLedgers, 1)
})

async function createTerminalActivationCleanupScenario(
  state: 'aborted' | 'expired',
  ledgerStatus: 'active' | 'committed' = 'active',
) {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '7a000000-0000-4000-8000-000000000726'
  const documentId = 'doc-main'
  const pdf = new TextEncoder().encode('%PDF-1.7\nterminal-activation')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  await value.r2.put(objectKey, pdf, { sha256: sha })
  const retiredAt = new Date(value.now * 1000).toISOString()
  const activeManifest: PdfManifest = {
    ...value.manifest,
    access_version: 2,
    documents: [
      ...value.manifest.documents.map((document) =>
        document.document_id === documentId && document.visible
          ? {
              ...document,
              archive_expires_at: retiredAt,
              delete_after: retiredAt,
              visible: false,
            }
          : document,
      ),
      {
        archive_expires_at: null,
        byte_size: pdf.byteLength,
        delete_after: null,
        display_name: 'Replacement material',
        document_id: documentId,
        document_version: sha,
        download_enabled: true,
        object_key: objectKey,
        page_count: 1,
        pdf_sha256: sha,
        text_char_count: 12,
        text_sha256: '8'.repeat(64),
        visible: true,
      },
    ],
    manifest_version: value.manifest.manifest_version + 2,
    updated_at: retiredAt,
  }
  const activeManifestObject = await value.r2.put(
    `manifests/${value.lecture}/manifest.json`,
    encodeManifest(activeManifest),
  )
  assert.ok(activeManifestObject)
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 3,
    manifestEtag:
      ledgerStatus === 'active'
        ? activeManifestObject.etag
        : 'committed-etag-2',
    manifestVersion:
      ledgerStatus === 'active'
        ? activeManifest.manifest_version
        : value.manifest.manifest_version + 1,
    objectKey,
    pdfSha256: sha,
    previousAccessVersion: 1,
    previousDocumentVersions: [value.version],
    publicationId,
    status: ledgerStatus,
    targetAccessVersion: ledgerStatus === 'active' ? 2 : undefined,
    ticketJti: '7a100000-0000-4000-8000-000000000726',
  })
  const completions: Array<Record<string, unknown>> = []
  const makeFetcher = (
    cleanupClaimId: string,
    overrides: Record<string, unknown> = {},
  ) => {
    let available = true
    return (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (body.action === 'claimCleanup') {
        const data = available
          ? [
              {
                activation_operation_id:
                  '7a200000-0000-4000-8000-000000000726',
                activation_target_access_version: 2,
                activated_manifest_etag:
                  ledgerStatus === 'active'
                    ? activeManifestObject.etag
                    : null,
                activated_manifest_version:
                  ledgerStatus === 'active'
                    ? activeManifest.manifest_version
                    : null,
                cleanup_binding_version: 1,
                cleanup_claim_id: cleanupClaimId,
                cleanup_worker_generation: 3,
                committed_manifest_access_version: 1,
                committed_manifest_etag: 'committed-etag-2',
                committed_manifest_version:
                  value.manifest.manifest_version + 1,
                document_id: documentId,
                expected_byte_size: pdf.byteLength,
                expected_pdf_sha256: sha,
                lecture_public_id: value.lecture,
                object_key: objectKey,
                pdf_access_version: 1,
                publication_id: publicationId,
                state,
                ...overrides,
              },
            ]
          : []
        available = false
        return Response.json({ data, ok: true })
      }
      completions.push(body)
      return Response.json({ ok: true })
    }) as typeof fetch
  }
  return {
    completions,
    makeFetcher,
    objectKey,
    publicationId,
    sha,
    value,
  }
}

test('aborted DB publication rolls back an uncommitted Worker activation before deleting bytes', async () => {
  const scenario = await createTerminalActivationCleanupScenario('aborted')
  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('7a300000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)
  assert.equal(
    scenario.completions.at(-1)?.errorCode,
    'cleanup_quiescence_pending',
  )
  const result = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('7a310000-0000-4000-8000-000000000726'),
  )
  assert.deepEqual(result, {
    deletedLedgers: 1,
    deletedObjects: 1,
    failures: 0,
    scanned: 1,
    skipped: false,
  })
  const manifestObject = await scenario.value.r2.get(
    `manifests/${scenario.value.lecture}/manifest.json`,
  )
  assert.ok(manifestObject)
  const manifest = decodeManifest(
    new Uint8Array(await manifestObject.arrayBuffer!()),
  )
  assert.equal(manifest.access_version, 1)
  assert.equal(
    manifest.documents.some(
      (document) => document.document_version === scenario.sha,
    ),
    false,
  )
  const restored = manifest.documents.find(
    (document) => document.document_version === scenario.value.version,
  )
  assert.ok(restored)
  assert.equal(restored.visible, true)
  assert.equal(restored.archive_expires_at, null)
  assert.equal(restored.delete_after, null)
  assert.equal(scenario.completions.at(-1)?.succeeded, true)
})

test('expired activation cleanup is retryable after a manifest CAS conflict', async () => {
  const scenario = await createTerminalActivationCleanupScenario('expired')
  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('7a400000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)
  scenario.value.r2.failNextConditionalKey =
    `manifests/${scenario.value.lecture}/manifest.json`
  const conflicted = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('7a410000-0000-4000-8000-000000000726'),
  )
  assert.equal(conflicted.failures, 1)
  assert.equal(
    scenario.completions.at(-1)?.errorCode,
    'cleanup_activation_rollback_manifest_conflict',
  )
  assert.ok(await scenario.value.r2.head(scenario.objectKey))
  assert.equal(
    (await readPublicationLedger(scenario.value, scenario.publicationId)).status,
    'cleanup_pending',
  )

  const retried = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 602) * 1000),
    25,
    scenario.makeFetcher('7a420000-0000-4000-8000-000000000726'),
  )
  assert.equal(retried.failures, 0)
  assert.equal(retried.deletedObjects, 1)
  assert.equal(retried.deletedLedgers, 1)
})

test('terminal activation cleanup resumes after manifest rollback and a lost ledger CAS', async () => {
  const scenario = await createTerminalActivationCleanupScenario('aborted')
  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('7a600000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)
  scenario.value.r2.failNextConditionalKey =
    `publication-ledger/${scenario.publicationId}.json`
  const interrupted = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('7a610000-0000-4000-8000-000000000726'),
  )
  assert.equal(interrupted.failures, 1)
  assert.equal(
    scenario.completions.at(-1)?.errorCode,
    'cleanup_activation_rollback_ledger_conflict',
  )
  assert.ok(await scenario.value.r2.head(scenario.objectKey))
  assert.equal(
    (await readPublicationLedger(scenario.value, scenario.publicationId)).status,
    'cleanup_pending',
  )
  const restoredManifestObject = await scenario.value.r2.get(
    `manifests/${scenario.value.lecture}/manifest.json`,
  )
  assert.ok(restoredManifestObject)
  assert.equal(
    decodeManifest(
      new Uint8Array(await restoredManifestObject.arrayBuffer!()),
    ).access_version,
    1,
  )

  const retried = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 602) * 1000),
    25,
    scenario.makeFetcher('7a620000-0000-4000-8000-000000000726'),
  )
  assert.equal(retried.failures, 0)
  assert.equal(retried.deletedObjects, 1)
  assert.equal(retried.deletedLedgers, 1)
})

test('terminal cleanup never rolls back or deletes another Worker generation', async () => {
  const scenario = await createTerminalActivationCleanupScenario('expired')
  const result = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('7a800000-0000-4000-8000-000000000726', {
      cleanup_worker_generation: 4,
    }),
  )
  assert.equal(result.failures, 1)
  assert.equal(
    scenario.completions.at(-1)?.errorCode,
    'cleanup_ledger_binding_invalid',
  )
  assert.ok(await scenario.value.r2.head(scenario.objectKey))
  assert.equal(
    (await readPublicationLedger(scenario.value, scenario.publicationId)).status,
    'active',
  )
  const manifestObject = await scenario.value.r2.get(
    `manifests/${scenario.value.lecture}/manifest.json`,
  )
  assert.ok(manifestObject)
  assert.equal(
    decodeManifest(new Uint8Array(await manifestObject.arrayBuffer!()))
      .access_version,
    2,
  )
})

test('cleanup repairs an activation manifest when its ledger CAS left the ledger committed', async () => {
  const scenario = await createTerminalActivationCleanupScenario(
    'expired',
    'committed',
  )
  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('7a900000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)

  const repaired = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('7a910000-0000-4000-8000-000000000726'),
  )
  assert.equal(repaired.failures, 0)
  assert.equal(repaired.deletedObjects, 1)
  assert.equal(repaired.deletedLedgers, 1)
  const manifestObject = await scenario.value.r2.get(
    `manifests/${scenario.value.lecture}/manifest.json`,
  )
  assert.ok(manifestObject)
  const manifest = decodeManifest(
    new Uint8Array(await manifestObject.arrayBuffer!()),
  )
  assert.equal(manifest.access_version, 1)
  assert.equal(
    manifest.documents.some(
      (document) => document.document_version === scenario.sha,
    ),
    false,
  )
})

test('terminal activation rollback preserves an unrelated retention manifest update', async () => {
  const scenario = await createTerminalActivationCleanupScenario('aborted')
  const manifestKey = `manifests/${scenario.value.lecture}/manifest.json`
  const currentObject = await scenario.value.r2.get(manifestKey)
  assert.ok(currentObject)
  const current = decodeManifest(
    new Uint8Array(await currentObject.arrayBuffer!()),
  )
  const retentionMarker = new Date(
    (scenario.value.now + 123) * 1000,
  ).toISOString()
  const retentionUpdated = parseManifest({
    ...current,
    documents: current.documents.map((document) =>
      document.document_id === 'doc-retired'
        ? {
            ...document,
            archive_expires_at: retentionMarker,
            delete_after: retentionMarker,
          }
        : document,
    ),
    manifest_version: current.manifest_version + 1,
    updated_at: retentionMarker,
  })
  assert.ok(
    await scenario.value.r2.put(
      manifestKey,
      encodeManifest(retentionUpdated),
      { onlyIf: { etagMatches: currentObject.etag } },
    ),
  )

  const quiescing = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date(scenario.value.now * 1000),
    25,
    scenario.makeFetcher('7a700000-0000-4000-8000-000000000726'),
  )
  assert.equal(quiescing.failures, 1)
  const cleaned = await cleanupExpiredPdfPublications(
    scenario.value.env,
    new Date((scenario.value.now + 601) * 1000),
    25,
    scenario.makeFetcher('7a800000-0000-4000-8000-000000000726'),
  )
  assert.equal(cleaned.failures, 0)
  const restoredObject = await scenario.value.r2.get(manifestKey)
  assert.ok(restoredObject)
  const restored = decodeManifest(
    new Uint8Array(await restoredObject.arrayBuffer!()),
  )
  assert.equal(restored.access_version, 1)
  assert.equal(
    restored.documents.some(
      (document) => document.document_version === scenario.sha,
    ),
    false,
  )
  assert.equal(
    restored.documents.find(
      (document) => document.document_id === 'doc-retired',
    )?.delete_after,
    retentionMarker,
  )
})

test('cleanup tombstone fences a slow upload between receiving-ledger creation and immutable object write', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '7aa00000-0000-4000-8000-000000000726'
  const cleanupClaimId = '7ab00000-0000-4000-8000-000000000726'
  const documentId = 'slow-upload-material'
  const pdf = new TextEncoder().encode('%PDF-1.7\nslow-upload')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  const uploadTicket = await createUploadTicket(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    jti: '7ac00000-0000-4000-8000-000000000726',
    nonce: 'V'.repeat(43),
    pdfSha256: sha,
    publicationId,
  })
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    (async () => Response.json({ ok: true })) as typeof fetch,
  )
  const paused = value.r2.pauseNextPut(objectKey)
  const uploading = worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: pdf,
      headers: {
        Authorization: `Bearer ${uploadTicket}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://compass.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  await paused.started
  const secondPaused = value.r2.pauseNextPut(objectKey)
  const secondUploading = worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: pdf,
      headers: {
        Authorization: `Bearer ${uploadTicket}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://compass.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  await secondPaused.started

  const completions: Array<Record<string, unknown>> = []
  const cleanupFetcher = (claimId: string) => {
    let available = true
    return (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (body.action === 'claimCleanup') {
        const data = available
          ? [
              {
                activation_operation_id: null,
                activation_target_access_version: null,
                cleanup_binding_version: 1,
                cleanup_claim_id: claimId,
                cleanup_worker_generation: 1,
                committed_manifest_access_version: null,
                committed_manifest_etag: null,
                committed_manifest_version: null,
                document_id: documentId,
                expected_byte_size: pdf.byteLength,
                expected_pdf_sha256: sha,
                lecture_public_id: value.lecture,
                object_key: objectKey,
                pdf_access_version: 1,
                publication_id: publicationId,
                state: 'aborted',
              },
            ]
          : []
        available = false
        return Response.json({ data, ok: true })
      }
      completions.push(body)
      return Response.json({ ok: true })
    }) as typeof fetch
  }
  const quiescing = await cleanupExpiredPdfPublications(
    value.env,
    new Date(value.now * 1000),
    25,
    cleanupFetcher(cleanupClaimId),
  )
  assert.equal(quiescing.failures, 1)
  assert.equal(completions.at(-1)?.errorCode, 'cleanup_quiescence_pending')
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'cleanup_pending',
  )

  const completed = await cleanupExpiredPdfPublications(
    value.env,
    new Date((value.now + 601) * 1000),
    25,
    cleanupFetcher('7ad00000-0000-4000-8000-000000000726'),
  )
  assert.equal(completed.failures, 0)
  assert.equal(completed.deletedObjects, 0)
  assert.equal(completed.deletedLedgers, 1)
  assert.equal(
    (await value.r2.head(objectKey))?.customMetadata
      ?.compassCleanupTombstone,
    'v1',
  )
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'cleanup_complete',
  )

  paused.release()
  secondPaused.release()
  const uploadResponses = await Promise.all([uploading, secondUploading])
  assert.deepEqual(
    uploadResponses.map((response) => response.status),
    [409, 409],
  )
  assert.equal(
    await (async () => {
      const object = await value.r2.get(objectKey, {
        range: { length: 5, offset: 0 },
      })
      assert.ok(object)
      return new TextDecoder().decode(
        new Uint8Array(await object.arrayBuffer!()),
      )
    })(),
    'COMPA',
    'the permanent tombstone still wins after DB cleanup completion',
  )
})

test('legacy retention and recovery never delete a browser-publication object or its terminal tombstone', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '7ad00000-0000-4000-8000-000000000726'
  const cleanupClaimId = '7ac00000-0000-4000-8000-000000000726'
  const documentId = 'legacy-retention-boundary'
  const pdf = new TextEncoder().encode('%PDF-1.7\nlegacy-boundary')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  const boundedSha = '3'.repeat(64)
  const boundedObjectKey =
    `pdf/${value.lecture}/legacy-retention-second/${boundedSha}/` +
    '7a900000-0000-4000-8000-000000000726.pdf'
  await value.r2.put(objectKey, pdf, { sha256: sha })
  await value.r2.put(boundedObjectKey, pdf)
  const manifestKey = `manifests/${value.lecture}/manifest.json`
  const dueAt = new Date((value.now - 1) * 1000).toISOString()
  const withDueBrowserObject = parseManifest({
    ...value.manifest,
    documents: [
      ...value.manifest.documents,
      {
        archive_expires_at: dueAt,
        byte_size: pdf.byteLength,
        delete_after: dueAt,
        display_name: 'Browser retention boundary',
        document_id: documentId,
        document_version: sha,
        download_enabled: false,
        object_key: objectKey,
        page_count: 1,
        pdf_sha256: sha,
        text_char_count: 12,
        text_sha256: '4'.repeat(64),
        visible: false,
      },
      {
        archive_expires_at: dueAt,
        byte_size: pdf.byteLength,
        delete_after: dueAt,
        display_name: 'Second browser retention boundary',
        document_id: 'legacy-retention-second',
        document_version: boundedSha,
        download_enabled: false,
        object_key: boundedObjectKey,
        page_count: 1,
        pdf_sha256: boundedSha,
        text_char_count: 12,
        text_sha256: '5'.repeat(64),
        visible: false,
      },
    ],
    manifest_version: value.manifest.manifest_version + 1,
  })
  await value.r2.put(manifestKey, encodeManifest(withDueBrowserObject))
  value.r2.failNextDeleteKey = objectKey
  const legacy = await cleanupExpiredDocuments(
    value.env,
    new Date(value.now * 1000),
    1,
  )
  assert.equal(legacy.conflicts, 0)
  assert.equal(legacy.processed, 1)
  assert.ok(await value.r2.head(objectKey))
  assert.equal(value.r2.failNextDeleteKey, objectKey)
  const legacyManifestObject = await value.r2.get(manifestKey)
  assert.ok(legacyManifestObject)
  assert.equal(
    decodeManifest(
      new Uint8Array(await legacyManifestObject.arrayBuffer!()),
    ).documents.some((document) => document.object_key === objectKey),
    false,
  )
  assert.equal(
    decodeManifest(
      new Uint8Array(await legacyManifestObject.arrayBuffer!()),
    ).documents.some(
      (document) => document.object_key === boundedObjectKey,
    ),
    true,
    'browser-owned retention work is bounded by the requested limit',
  )

  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    objectKey,
    pdfSha256: sha,
    publicationId,
    status: 'uploaded',
    ticketJti: '7ab00000-0000-4000-8000-000000000726',
  })
  const cleanupJob = {
    activated_manifest_etag: null,
    activated_manifest_version: null,
    activation_operation_id: null,
    activation_target_access_version: null,
    cleanup_binding_version: 1,
    cleanup_worker_generation: 1,
    committed_manifest_access_version: null,
    committed_manifest_etag: null,
    committed_manifest_version: null,
    document_id: documentId,
    expected_byte_size: pdf.byteLength,
    expected_pdf_sha256: sha,
    lecture_public_id: value.lecture,
    object_key: objectKey,
    pdf_access_version: 1,
    publication_id: publicationId,
    state: 'retired',
  }
  const completions: Array<Record<string, unknown>> = []
  await cleanupExpiredPdfPublications(
    value.env,
    new Date(value.now * 1000),
    25,
    singleCleanupFetcher(
      { ...cleanupJob, cleanup_claim_id: cleanupClaimId },
      completions,
    ),
  )
  const phase726Cleanup = await cleanupExpiredPdfPublications(
    value.env,
    new Date((value.now + 601) * 1000),
    25,
    singleCleanupFetcher(
      {
        ...cleanupJob,
        cleanup_claim_id: '7aa00000-0000-4000-8000-000000000726',
      },
      completions,
    ),
  )
  assert.equal(phase726Cleanup.failures, 0)
  assert.equal(
    (await value.r2.head(objectKey))?.customMetadata
      ?.compassCleanupTombstone,
    'v1',
  )

  const recoveryIntentKey =
    `cleanup-pending/${value.lecture}/${sha}.json`
  await value.r2.put(
    recoveryIntentKey,
    `${JSON.stringify({
      document_id: documentId,
      document_version: sha,
      lecture_public_id: value.lecture,
      object_key: objectKey,
      requested_at: new Date(value.now * 1000).toISOString(),
      schema_version: 1,
    })}\n`,
  )
  const recovered = await cleanupExpiredDocuments(
    value.env,
    new Date((value.now + 602) * 1000),
    50,
  )
  assert.ok(recovered.pendingScanned >= 1)
  assert.equal(await value.r2.head(recoveryIntentKey), null)
  assert.equal(
    (await value.r2.head(objectKey))?.customMetadata
      ?.compassCleanupTombstone,
    'v1',
  )
  assert.equal(value.r2.failNextDeleteKey, objectKey)
})

test('cleanup completion permanently fences a commit paused before an initially unrelated manifest CAS', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '7ae00000-0000-4000-8000-000000000726'
  const documentId = 'delayed-commit'
  const pdf = new TextEncoder().encode('%PDF-1.7\ndelayed-commit')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  await value.r2.put(objectKey, pdf, { sha256: sha })
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    objectKey,
    pdfSha256: sha,
    publicationId,
    status: 'uploaded',
    ticketJti: '7af00000-0000-4000-8000-000000000726',
  })
  const commitTicket = await createPublicationToken(value.keys.privateKey, {
    aud: 'compass-pdf-publication-worker',
    bytes: pdf.byteLength,
    doc: documentId,
    download: true,
    exp: value.now + 300,
    gen: 1,
    iat: value.now,
    iss: 'compass-supabase',
    jti: '7b000000-0000-4000-8000-000000000726',
    lec: value.lecture,
    name: 'Delayed commit',
    nbf: value.now - 1,
    origin: 'https://compass.example',
    pages: 1,
    previous_av: 1,
    pub: publicationId,
    purpose: 'commit',
    sha,
    sid: '79000000-0000-4000-8000-000000000726',
    text_chars: 14,
    text_sha: '5'.repeat(64),
  })
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    (async () => Response.json({ ok: true })) as typeof fetch,
  )
  const manifestKey = `manifests/${value.lecture}/manifest.json`
  const paused = value.r2.pauseNextPut(manifestKey)
  const committing = worker.fetch(
    new Request(
      `https://pdf.example/v2/pdf-publications/${publicationId}/commit`,
      {
        headers: { Authorization: `Bearer ${commitTicket}` },
        method: 'POST',
      },
    ),
    value.env,
  )
  await paused.started

  const cleanupJob = {
    activated_manifest_etag: null,
    activated_manifest_version: null,
    activation_operation_id: null,
    activation_target_access_version: null,
    cleanup_binding_version: 1,
    cleanup_worker_generation: 1,
    committed_manifest_access_version: null,
    committed_manifest_etag: null,
    committed_manifest_version: null,
    document_id: documentId,
    expected_byte_size: pdf.byteLength,
    expected_pdf_sha256: sha,
    lecture_public_id: value.lecture,
    object_key: objectKey,
    pdf_access_version: 1,
    publication_id: publicationId,
    state: 'aborted',
  }
  const completions: Array<Record<string, unknown>> = []
  await cleanupExpiredPdfPublications(
    value.env,
    new Date(value.now * 1000),
    25,
    singleCleanupFetcher(
      {
        ...cleanupJob,
        cleanup_claim_id: '7b100000-0000-4000-8000-000000000726',
      },
      completions,
    ),
  )
  const cleaned = await cleanupExpiredPdfPublications(
    value.env,
    new Date((value.now + 601) * 1000),
    25,
    singleCleanupFetcher(
      {
        ...cleanupJob,
        cleanup_claim_id: '7b200000-0000-4000-8000-000000000726',
      },
      completions,
    ),
  )
  assert.equal(cleaned.failures, 0)
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'cleanup_complete',
  )

  paused.release()
  assert.equal((await committing).status, 409)
  const manifestObject = await value.r2.get(manifestKey)
  assert.ok(manifestObject)
  const manifest = decodeManifest(
    new Uint8Array(await manifestObject.arrayBuffer!()),
  )
  assert.equal(
    manifest.documents.some(
      (document) => document.document_version === sha,
    ),
    false,
  )
})

test('cleanup completion wins a delayed activation and removes only its hidden staged document', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '7b300000-0000-4000-8000-000000000726'
  const documentId = 'delayed-activation'
  const pdf = new TextEncoder().encode('%PDF-1.7\ndelayed-activation')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  await value.r2.put(objectKey, pdf, { sha256: sha })
  const stagedManifest = parseManifest({
    ...value.manifest,
    documents: [
      ...value.manifest.documents,
      {
        archive_expires_at: null,
        byte_size: pdf.byteLength,
        delete_after: null,
        display_name: 'Delayed activation',
        document_id: documentId,
        document_version: sha,
        download_enabled: true,
        object_key: objectKey,
        page_count: 1,
        pdf_sha256: sha,
        text_char_count: 18,
        text_sha256: '6'.repeat(64),
        visible: false,
      },
    ],
    manifest_version: value.manifest.manifest_version + 1,
  })
  const manifestKey = `manifests/${value.lecture}/manifest.json`
  const stagedObject = await value.r2.put(
    manifestKey,
    encodeManifest(stagedManifest),
  )
  assert.ok(stagedObject)
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    manifestEtag: stagedObject.etag,
    manifestVersion: stagedManifest.manifest_version,
    objectKey,
    pdfSha256: sha,
    previousAccessVersion: 1,
    previousDocumentVersions: [],
    publicationId,
    status: 'committed',
    ticketJti: '7b400000-0000-4000-8000-000000000726',
  })
  const activationTicket = await createPublicationToken(
    value.keys.privateKey,
    {
      aud: 'compass-pdf-publication-worker',
      bytes: pdf.byteLength,
      doc: documentId,
      exp: value.now + 300,
      gen: 1,
      iat: value.now,
      iss: 'compass-supabase',
      jti: '7b500000-0000-4000-8000-000000000726',
      lec: value.lecture,
      nbf: value.now - 1,
      origin: 'https://compass.example',
      previous_av: 1,
      pub: publicationId,
      purpose: 'activate',
      sha,
      sid: '79000000-0000-4000-8000-000000000726',
      target_av: 2,
    },
  )
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    (async () => Response.json({ ok: true })) as typeof fetch,
  )
  const paused = value.r2.pauseNextPut(manifestKey)
  const activating = worker.fetch(
    new Request(
      `https://pdf.example/v2/pdf-publications/${publicationId}/activate`,
      {
        headers: { Authorization: `Bearer ${activationTicket}` },
        method: 'POST',
      },
    ),
    value.env,
  )
  await paused.started
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'activating',
  )

  const cleanupJob = {
    activated_manifest_etag: null,
    activated_manifest_version: null,
    activation_operation_id: '7b600000-0000-4000-8000-000000000726',
    activation_target_access_version: 2,
    cleanup_binding_version: 1,
    cleanup_worker_generation: 1,
    committed_manifest_access_version: 1,
    committed_manifest_etag: stagedObject.etag,
    committed_manifest_version: stagedManifest.manifest_version,
    document_id: documentId,
    expected_byte_size: pdf.byteLength,
    expected_pdf_sha256: sha,
    lecture_public_id: value.lecture,
    object_key: objectKey,
    pdf_access_version: 1,
    publication_id: publicationId,
    state: 'aborted',
  }
  const completions: Array<Record<string, unknown>> = []
  await cleanupExpiredPdfPublications(
    value.env,
    new Date(value.now * 1000),
    25,
    singleCleanupFetcher(
      {
        ...cleanupJob,
        cleanup_claim_id: '7b700000-0000-4000-8000-000000000726',
      },
      completions,
    ),
  )
  const cleaned = await cleanupExpiredPdfPublications(
    value.env,
    new Date((value.now + 601) * 1000),
    25,
    singleCleanupFetcher(
      {
        ...cleanupJob,
        cleanup_claim_id: '7b800000-0000-4000-8000-000000000726',
      },
      completions,
    ),
  )
  assert.equal(cleaned.failures, 0)
  paused.release()
  assert.equal((await activating).status, 409)
  const manifestObject = await value.r2.get(manifestKey)
  assert.ok(manifestObject)
  const manifest = decodeManifest(
    new Uint8Array(await manifestObject.arrayBuffer!()),
  )
  assert.equal(manifest.access_version, 1)
  assert.equal(
    manifest.documents.some(
      (document) => document.document_version === sha,
    ),
    false,
  )
  assert.equal(
    manifest.documents.some(
      (document) => document.document_version === value.version,
    ),
    true,
  )
})

test('activation rebases onto intervening Local Publisher changes and rollback restores the true predecessor', async () => {
  for (const sameDocument of [false, true]) {
    const value = await fixture()
    enablePdfPublicationEnvironment(value)
    const marker = sameDocument ? '7c' : '7d'
    const publicationId = `${marker}000000-0000-4000-8000-000000000726`
    const documentId = sameDocument ? 'doc-main' : 'browser-cross-path'
    const pdf = new TextEncoder().encode(
      `%PDF-1.7\ncross-path-${sameDocument ? 'same' : 'different'}`,
    )
    const sha = createHash('sha256').update(pdf).digest('hex')
    const objectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
    await value.r2.put(objectKey, pdf, { sha256: sha })
    const stagedManifest = parseManifest({
      ...value.manifest,
      documents: [
        ...value.manifest.documents,
        {
          archive_expires_at: null,
          byte_size: pdf.byteLength,
          delete_after: null,
          display_name: 'Browser cross-path target',
          document_id: documentId,
          document_version: sha,
          download_enabled: true,
          object_key: objectKey,
          page_count: 1,
          pdf_sha256: sha,
          text_char_count: 10,
          text_sha256: '7'.repeat(64),
          visible: false,
        },
      ],
      manifest_version: value.manifest.manifest_version + 1,
    })
    const manifestKey = `manifests/${value.lecture}/manifest.json`
    const stagedObject = await value.r2.put(
      manifestKey,
      encodeManifest(stagedManifest),
    )
    assert.ok(stagedObject)
    await seedPublicationLedger(value, {
      bytes: pdf.byteLength,
      documentId,
      generation: 1,
      manifestEtag: stagedObject.etag,
      manifestVersion: stagedManifest.manifest_version,
      objectKey,
      pdfSha256: sha,
      previousAccessVersion: 1,
      previousDocumentVersions: sameDocument ? [value.version] : [],
      publicationId,
      status: 'committed',
      ticketJti: `${marker}100000-0000-4000-8000-000000000726`,
    })

    const localVersion = sameDocument ? '8'.repeat(64) : '9'.repeat(64)
    const localDocumentId = sameDocument ? documentId : 'local-added'
    const localObjectKey = `pdf/${value.lecture}/${localDocumentId}/${localVersion}.pdf`
    const changedAt = new Date((value.now + 1) * 1000).toISOString()
    const localManifest = parseManifest({
      ...stagedManifest,
      documents: [
        ...stagedManifest.documents.map((document) =>
          sameDocument &&
          document.document_id === documentId &&
          document.visible
            ? {
                ...document,
                archive_expires_at: changedAt,
                delete_after: changedAt,
                visible: false,
              }
            : document,
        ),
        {
          archive_expires_at: null,
          byte_size: 24,
          delete_after: null,
          display_name: 'Local Publisher interleave',
          document_id: localDocumentId,
          document_version: localVersion,
          download_enabled: true,
          object_key: localObjectKey,
          page_count: 1,
          pdf_sha256: localVersion,
          text_char_count: 12,
          text_sha256: 'a'.repeat(64),
          visible: true,
        },
      ],
      manifest_version: stagedManifest.manifest_version + 1,
      updated_at: changedAt,
    })
    const localObject = await value.r2.put(
      manifestKey,
      encodeManifest(localManifest),
      { onlyIf: { etagMatches: stagedObject.etag } },
    )
    assert.ok(localObject)

    const baseClaims = {
      aud: 'compass-pdf-publication-worker',
      bytes: pdf.byteLength,
      doc: documentId,
      exp: value.now + 300,
      gen: 1,
      iat: value.now,
      iss: 'compass-supabase',
      lec: value.lecture,
      nbf: value.now - 1,
      origin: 'https://compass.example',
      previous_av: 1,
      pub: publicationId,
      sha,
      sid: '79000000-0000-4000-8000-000000000726',
      target_av: 2,
    }
    const activationTicket = await createPublicationToken(
      value.keys.privateKey,
      {
        ...baseClaims,
        jti: `${marker}200000-0000-4000-8000-000000000726`,
        purpose: 'activate',
      },
    )
    const worker = createAssetWorker(
      () => new Date(value.now * 1000),
      (async () => Response.json({ ok: true })) as typeof fetch,
    )
    const activated = await worker.fetch(
      new Request(
        `https://pdf.example/v2/pdf-publications/${publicationId}/activate`,
        {
          headers: { Authorization: `Bearer ${activationTicket}` },
          method: 'POST',
        },
      ),
      value.env,
    )
    assert.equal(activated.status, 200)
    assert.deepEqual(
      (await readPublicationLedger(value, publicationId))
        .previousDocumentVersions,
      sameDocument ? [localVersion] : [],
    )

    const rollbackTicket = await createPublicationToken(
      value.keys.privateKey,
      {
        ...baseClaims,
        jti: `${marker}300000-0000-4000-8000-000000000726`,
        purpose: 'rollback',
      },
    )
    const rolledBack = await worker.fetch(
      new Request(
        `https://pdf.example/v2/pdf-publications/${publicationId}/rollback`,
        {
          headers: { Authorization: `Bearer ${rollbackTicket}` },
          method: 'POST',
        },
      ),
      value.env,
    )
    assert.equal(rolledBack.status, 200)
    const restoredObject = await value.r2.get(manifestKey)
    assert.ok(restoredObject)
    const restored = decodeManifest(
      new Uint8Array(await restoredObject.arrayBuffer!()),
    )
    assert.equal(restored.access_version, 1)
    assert.equal(
      restored.documents.some(
        (document) => document.document_version === sha,
      ),
      false,
    )
    assert.equal(
      restored.documents.some(
        (document) =>
          document.document_version === localVersion && document.visible,
      ),
      true,
    )
  }
})

test('same document and hash at a Local Publisher key blocks activation while merge rollback preserves Local visibility', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  const publicationId = '7e000000-0000-4000-8000-000000000726'
  const documentId = 'cross-path-hash-collision'
  const pdf = new TextEncoder().encode('%PDF-1.7\nshared-hash')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const browserObjectKey = `pdf/${value.lecture}/${documentId}/${sha}/${publicationId}.pdf`
  const localObjectKey = `pdf/${value.lecture}/${documentId}/${sha}.pdf`
  await value.r2.put(browserObjectKey, pdf, { sha256: sha })
  await value.r2.put(localObjectKey, pdf, { sha256: sha })
  const manifestKey = `manifests/${value.lecture}/manifest.json`
  const stagedManifest = parseManifest({
    ...value.manifest,
    documents: [
      ...value.manifest.documents,
      {
        archive_expires_at: null,
        byte_size: pdf.byteLength,
        delete_after: null,
        display_name: 'Browser hash collision',
        document_id: documentId,
        document_version: sha,
        download_enabled: true,
        object_key: browserObjectKey,
        page_count: 1,
        pdf_sha256: sha,
        text_char_count: 9,
        text_sha256: 'b'.repeat(64),
        visible: false,
      },
    ],
    manifest_version: value.manifest.manifest_version + 1,
  })
  const stagedObject = await value.r2.put(
    manifestKey,
    encodeManifest(stagedManifest),
  )
  assert.ok(stagedObject)
  await seedPublicationLedger(value, {
    bytes: pdf.byteLength,
    documentId,
    generation: 1,
    manifestEtag: stagedObject.etag,
    manifestVersion: stagedManifest.manifest_version,
    objectKey: browserObjectKey,
    pdfSha256: sha,
    previousAccessVersion: 1,
    previousDocumentVersions: [],
    publicationId,
    status: 'committed',
    ticketJti: '7e100000-0000-4000-8000-000000000726',
  })
  const localManifest = parseManifest({
    ...stagedManifest,
    documents: [
      ...stagedManifest.documents,
      {
        archive_expires_at: null,
        byte_size: pdf.byteLength,
        delete_after: null,
        display_name: 'Local hash collision',
        document_id: documentId,
        document_version: sha,
        download_enabled: true,
        object_key: localObjectKey,
        page_count: 1,
        pdf_sha256: sha,
        text_char_count: 9,
        text_sha256: 'c'.repeat(64),
        visible: true,
      },
    ],
    manifest_version: stagedManifest.manifest_version + 1,
  })
  assert.ok(
    await value.r2.put(manifestKey, encodeManifest(localManifest), {
      onlyIf: { etagMatches: stagedObject.etag },
    }),
  )
  const baseClaims = {
    aud: 'compass-pdf-publication-worker',
    bytes: pdf.byteLength,
    doc: documentId,
    exp: value.now + 300,
    gen: 1,
    iat: value.now,
    iss: 'compass-supabase',
    lec: value.lecture,
    nbf: value.now - 1,
    origin: 'https://compass.example',
    previous_av: 1,
    pub: publicationId,
    sha,
    sid: '79000000-0000-4000-8000-000000000726',
    target_av: 2,
  }
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    (async () => Response.json({ ok: true })) as typeof fetch,
  )
  const activationTicket = await createPublicationToken(
    value.keys.privateKey,
    {
      ...baseClaims,
      jti: '7e200000-0000-4000-8000-000000000726',
      purpose: 'activate',
    },
  )
  assert.equal(
    (
      await worker.fetch(
        new Request(
          `https://pdf.example/v2/pdf-publications/${publicationId}/activate`,
          {
            headers: { Authorization: `Bearer ${activationTicket}` },
            method: 'POST',
          },
        ),
        value.env,
      )
    ).status,
    409,
  )
  assert.equal(
    (await readPublicationLedger(value, publicationId)).status,
    'committed',
  )
  const rollbackTicket = await createPublicationToken(value.keys.privateKey, {
    ...baseClaims,
    jti: '7e300000-0000-4000-8000-000000000726',
    purpose: 'rollback',
  })
  assert.equal(
    (
      await worker.fetch(
        new Request(
          `https://pdf.example/v2/pdf-publications/${publicationId}/rollback`,
          {
            headers: { Authorization: `Bearer ${rollbackTicket}` },
            method: 'POST',
          },
        ),
        value.env,
      )
    ).status,
    200,
  )
  const restoredObject = await value.r2.get(manifestKey)
  assert.ok(restoredObject)
  const restored = decodeManifest(
    new Uint8Array(await restoredObject.arrayBuffer!()),
  )
  assert.equal(
    restored.documents.some(
      (document) => document.object_key === browserObjectKey,
    ),
    false,
  )
  assert.equal(
    restored.documents.some(
      (document) =>
        document.object_key === localObjectKey && document.visible,
    ),
    true,
  )
})

test('publication coordinator permits only exact Supabase or loopback endpoints and sets bounded fetch controls', async () => {
  const invalidUrls = [
    'http://test-project.supabase.co/functions/v1/coordinate-pdf-upload-worker',
    'https://user:secret@test-project.supabase.co/functions/v1/coordinate-pdf-upload-worker',
    'https://test-project.supabase.co/functions/v1/coordinate-pdf-upload-worker?next=evil',
    'https://test-project.supabase.co/functions/v1/coordinate-pdf-upload-worker#fragment',
    'https://test-project.supabase.co/functions/v1/other',
    'https://test-project.supabase.co.evil.example/functions/v1/coordinate-pdf-upload-worker',
    'https://test-project.supabase.co:8443/functions/v1/coordinate-pdf-upload-worker',
  ]
  for (const coordinatorUrl of invalidUrls) {
    const value = await fixture()
    enablePdfPublicationEnvironment(value, coordinatorUrl)
    let called = false
    await assert.rejects(
      cleanupExpiredPdfPublications(
        value.env,
        new Date(value.now * 1000),
        25,
        (async () => {
          called = true
          return Response.json({ data: [], ok: true })
        }) as typeof fetch,
      ),
      /coordinator URL is invalid/,
    )
    assert.equal(called, false)
  }

  const allowedUrls = [
    TEST_COORDINATOR_URL,
    'http://127.0.0.1:54321/functions/v1/coordinate-pdf-upload-worker',
    'http://localhost:54321/functions/v1/coordinate-pdf-upload-worker',
  ]
  for (const coordinatorUrl of allowedUrls) {
    const value = await fixture()
    enablePdfPublicationEnvironment(value, coordinatorUrl)
    const result = await cleanupExpiredPdfPublications(
      value.env,
      new Date(value.now * 1000),
      25,
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        assert.equal(String(input), new URL(coordinatorUrl).toString())
        assert.equal(init?.redirect, 'error')
        assert.ok(init?.signal instanceof AbortSignal)
        assert.equal(init.signal.aborted, false)
        return Response.json({ data: [], ok: true })
      }) as typeof fetch,
    )
    assert.equal(result.scanned, 0)
  }
})

test('publication coordinator response is capped at 64 KiB even without Content-Length', async () => {
  const value = await fixture()
  enablePdfPublicationEnvironment(value)
  await assert.rejects(
    cleanupExpiredPdfPublications(
      value.env,
      new Date(value.now * 1000),
      25,
      (async () =>
        new Response('x'.repeat(64 * 1024 + 1), {
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
    ),
    /coordinator rejected request/,
  )
})

test('private PDF coordinator source rejects unknown actions before upload receipt handling', async () => {
  const source = await readFile(
    new URL(
      '../../../supabase/functions/coordinate-pdf-upload-worker/index.ts',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(source, /if \(body\.action !== 'recordUploaded'\)/)
  assert.match(source, /Coordinator action is invalid\./)
})
