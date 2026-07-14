import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  decodeManifest,
  encodeManifest,
} from '../../../publisher/src/manifest/manifest.ts'
import type { PdfManifest } from '../../../publisher/src/manifest/types.ts'
import {
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
    const stored = this.objects.get(key)
    return stored ? this.#object(key, stored, options?.range) : null
  }

  async head(key: string) {
    const stored = this.objects.get(key)
    return stored ? this.#object(key, stored) : null
  }

  async list(options: { cursor?: string; limit?: number; prefix: string }) {
    const objects = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(options.prefix))
      .slice(0, options.limit ?? 1000)
      .map(([key, stored]) => this.#object(key, stored))
    return { objects, truncated: false }
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
    const bytes =
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    const etag = createHash('sha256').update(bytes).digest('hex')
    this.objects.set(key, { bytes, etag })
    return this.#object(key, { bytes, etag })
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
