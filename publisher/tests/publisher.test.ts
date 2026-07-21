import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ConditionalObjectWriteError,
  type PrivateObjectStore,
  type PutObjectOptions,
} from '../src/cloudflare/objectStore.ts'
import { decodeManifest } from '../src/manifest/manifest.ts'
import { PdfValidationError, validatePdf } from '../src/pdf/validatePdf.ts'
import {
  ManifestConflictError,
  getManifestKey,
  publishPdf,
} from '../src/publishPdf.ts'
import { PublisherSessionManager } from '../src/security/publisherSession.ts'
import { syncLocalRetention } from '../src/retention/syncLocalRetention.ts'
import {
  createPublisherServer,
  getDefaultPublisherDataRoot,
} from '../src/server/publisherServer.ts'
import { FileObjectStore } from '../src/storage/fileObjectStore.ts'
import { LocalTextStore } from '../src/storage/localTextStore.ts'

const root = new URL('../../', import.meta.url)
const samplePath = new URL('public/lecture-assets/m4-sample-v1.pdf', root)

async function withStores(
  run: (values: {
    directory: string
    objectStore: FileObjectStore
    textStore: LocalTextStore
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'compass-p3-publisher-'))
  try {
    await run({
      directory,
      objectStore: new FileObjectStore(join(directory, 'r2')),
      textStore: new LocalTextStore(join(directory, 'text')),
    })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

function blankPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}

function publicationInput(bytes: Uint8Array, documentId = 'doc-main') {
  return {
    accessExpiresAt: '2026-08-13T00:00:00.000Z',
    accessVersion: 1,
    bytes,
    displayName: 'Phase 3 material',
    documentId,
    downloadEnabled: true,
    fileName: 'material.pdf',
    lecturePublicId: 'lecture_1234567890abcdef',
    mimeType: 'application/pdf',
  }
}

test('validates embedded text without rendering or OCR', async () => {
  const bytes = await readFile(samplePath)
  const validated = await validatePdf({
    bytes,
    fileName: 'sample.pdf',
    mimeType: 'application/pdf',
  })
  assert.equal(validated.pageCount, 3)
  assert.ok(validated.textCharCount > 0)
  assert.equal(validated.pages.length, 3)
  assert.match(validated.pdfSha256, /^[0-9a-f]{64}$/)
  assert.match(validated.textSha256, /^[0-9a-f]{64}$/)
  assert.ok(
    validated.pages.every((page) => /^[0-9a-f]{64}$/.test(page.excerptId)),
  )
})

test('rejects MIME spoofing, oversize input and a textless PDF before publish', async () => {
  const bytes = await readFile(samplePath)
  await assert.rejects(
    validatePdf({ bytes, fileName: 'sample.pdf', mimeType: 'text/plain' }),
    (error: unknown) =>
      error instanceof PdfValidationError && error.code === 'invalid_mime',
  )
  const oversized = Buffer.alloc(15 * 1024 * 1024 + 1)
  oversized.write('%PDF-')
  await assert.rejects(
    validatePdf({
      bytes: oversized,
      fileName: 'oversized.pdf',
      mimeType: 'application/pdf',
    }),
    (error: unknown) =>
      error instanceof PdfValidationError && error.code === 'size_limit',
  )
  await assert.rejects(
    validatePdf({
      bytes: blankPdf(),
      fileName: 'blank.pdf',
      mimeType: 'application/pdf',
    }),
    (error: unknown) =>
      error instanceof PdfValidationError && error.code === 'no_text_layer',
  )
})

test('publishes hash-addressed bytes, local text and a verified manifest', async () => {
  await withStores(async ({ directory, objectStore, textStore }) => {
    const bytes = await readFile(samplePath)
    const first = await publishPdf(publicationInput(bytes), {
      now: () => new Date('2026-07-14T00:00:00.000Z'),
      objectStore,
      textStore,
    })
    assert.equal(first.duplicate, false)
    assert.equal(first.manifestVersion, 1)
    assert.match(first.document.object_key, /[0-9a-f]{64}\.pdf$/)
    const object = await objectStore.get(first.document.object_key)
    assert.deepEqual(object?.bytes, bytes)
    const manifestObject = await objectStore.get(
      getManifestKey('lecture_1234567890abcdef'),
    )
    const manifest = decodeManifest(manifestObject!.bytes)
    assert.equal(
      manifest.documents[0]?.document_version,
      first.document.document_version,
    )
    const extraction = await readFile(
      join(
        directory,
        'text',
        'lecture_1234567890abcdef',
        `doc-main-${first.document.document_version}.json`,
      ),
      'utf8',
    )
    assert.match(extraction, /"pages":/)
    const loaded = await textStore.load({
      documentId: 'doc-main',
      documentVersion: first.document.document_version,
      lecturePublicId: 'lecture_1234567890abcdef',
    })
    assert.equal(loaded?.textSha256, first.document.text_sha256)
    assert.equal(loaded?.pages.length, first.document.page_count)
    assert.ok(loaded?.pages.every((page) => page.text.length > 0))

    const duplicate = await publishPdf(publicationInput(bytes), {
      objectStore,
      textStore,
    })
    assert.equal(duplicate.duplicate, true)
    assert.equal(duplicate.manifestVersion, 1)
  })
})

test('manifest CAS failure preserves the previously committed manifest', async () => {
  await withStores(async ({ objectStore, textStore }) => {
    const bytes = await readFile(samplePath)
    await publishPdf(publicationInput(bytes), { objectStore, textStore })
    class ConflictStore implements PrivateObjectStore {
      delete = objectStore.delete.bind(objectStore)
      get = objectStore.get.bind(objectStore)
      head = objectStore.head.bind(objectStore)
      async put(key: string, value: Uint8Array, options: PutObjectOptions) {
        if (key.endsWith('/manifest.json') && options.ifMatch) {
          throw new ConditionalObjectWriteError('simulated race')
        }
        return objectStore.put(key, value, options)
      }
    }
    await assert.rejects(
      publishPdf(publicationInput(bytes, 'doc-second'), {
        objectStore: new ConflictStore(),
        textStore,
      }),
      ManifestConflictError,
    )
    const manifest = decodeManifest(
      (await objectStore.get(getManifestKey('lecture_1234567890abcdef')))!
        .bytes,
    )
    assert.equal(manifest.manifest_version, 1)
    assert.equal(
      manifest.documents.filter((document) => document.visible).length,
      1,
    )
  })
})

test('recovery Publisher cannot downgrade a browser-publication access fence', async () => {
  await withStores(async ({ objectStore, textStore }) => {
    const bytes = await readFile(samplePath)
    await publishPdf(publicationInput(bytes), { objectStore, textStore })
    const manifestKey = getManifestKey('lecture_1234567890abcdef')
    const stored = await objectStore.get(manifestKey)
    assert.ok(stored)
    const manifest = decodeManifest(stored.bytes)
    await objectStore.put(
      manifestKey,
      new TextEncoder().encode(
        `${JSON.stringify({ ...manifest, access_version: 2 })}\n`,
      ),
      { contentType: 'application/json', ifMatch: stored.etag },
    )
    await assert.rejects(
      publishPdf(publicationInput(bytes, 'doc-downgrade'), {
        objectStore,
        textStore,
      }),
      (error: unknown) =>
        error instanceof ManifestConflictError &&
        /access version/i.test(error.message),
    )
    const current = decodeManifest((await objectStore.get(manifestKey))!.bytes)
    assert.equal(current.access_version, 2)
    assert.equal(
      current.documents.some(
        (document) => document.document_id === 'doc-downgrade',
      ),
      false,
    )
  })
})

test('pairing code is one-time and sessions are bound to their Origin', () => {
  let now = 1_000
  const sessions = new PublisherSessionManager(() => now, '12345678')
  const paired = sessions.pair('12345678', 'https://compass.example')
  assert.equal(sessions.verify(paired.token, 'https://compass.example'), true)
  assert.equal(sessions.verify(paired.token, 'https://evil.example'), false)
  assert.throws(() => sessions.pair('12345678', 'https://compass.example'))
  now = paired.expiresAt + 1
  assert.equal(sessions.verify(paired.token, 'https://compass.example'), false)
})

test('publisher data defaults outside the repository and ignores a blank override', () => {
  const applicationData = join(tmpdir(), 'compass-publisher-app-data')
  const expected = join(applicationData, 'COMPASS Interactive', 'Publisher')
  assert.equal(
    getDefaultPublisherDataRoot({
      COMPASS_PUBLISHER_DATA_DIR: '',
      LOCALAPPDATA: applicationData,
    }),
    expected,
  )
  const repositoryPath = fileURLToPath(new URL('../../', import.meta.url))
  const relativeToRepository = relative(
    repositoryPath,
    getDefaultPublisherDataRoot({
      COMPASS_PUBLISHER_DATA_DIR: '',
      LOCALAPPDATA: applicationData,
    }),
  )
  assert.equal(
    relativeToRepository === '' ||
      (!relativeToRepository.startsWith('..') &&
        !isAbsolute(relativeToRepository)),
    false,
  )
})

test('relative Publisher roots stay under application data and cannot traverse', () => {
  const applicationData = join(tmpdir(), 'compass-publisher-relative')
  const applicationPublisherRoot = join(
    applicationData,
    'COMPASS Interactive',
    'Publisher',
  )
  assert.equal(
    getDefaultPublisherDataRoot({
      COMPASS_PUBLISHER_DATA_DIR: 'teacher-a',
      LOCALAPPDATA: applicationData,
    }),
    join(applicationPublisherRoot, 'teacher-a'),
  )
  assert.throws(
    () =>
      getDefaultPublisherDataRoot({
        COMPASS_PUBLISHER_DATA_DIR: '..\\..\\..\\unsafe',
        LOCALAPPDATA: applicationData,
      }),
    /outside the repository/,
  )
})

test('Publisher rejects an explicit repository data root and accepts an external absolute root', () => {
  const repositoryPath = fileURLToPath(new URL('../../', import.meta.url))
  const externalRoot = join(tmpdir(), 'compass-publisher-explicit')
  assert.throws(
    () =>
      getDefaultPublisherDataRoot({
        COMPASS_PUBLISHER_DATA_DIR: repositoryPath,
        LOCALAPPDATA: join(tmpdir(), 'compass-publisher-app-data'),
      }),
    /outside the repository/,
  )
  assert.equal(
    getDefaultPublisherDataRoot({
      COMPASS_PUBLISHER_DATA_DIR: externalRoot,
      LOCALAPPDATA: join(tmpdir(), 'compass-publisher-app-data'),
    }),
    externalRoot,
  )
})

test('canonical retention feed updates and expires teacher-local text', async () => {
  await withStores(async ({ directory, objectStore, textStore }) => {
    const bytes = await readFile(samplePath)
    const published = await publishPdf(
      { ...publicationInput(bytes), accessExpiresAt: null },
      {
        objectStore,
        textStore,
      },
    )
    const archiveExpiresAt = '2026-08-13T00:00:00.000Z'
    const deleteAfter = '2026-08-20T00:00:00.000Z'
    const updated = await syncLocalRetention({
      feedUrl:
        'https://example.supabase.co/functions/v1/get-pdf-retention-feed',
      fetcher: async () =>
        Response.json({
          contractVersion: 1,
          generatedAt: '2026-07-14T00:00:00.000Z',
          hasMore: false,
          items: [
            {
              archiveExpiresAt,
              deleteAfter,
              documentId: 'doc-main',
              documentVersion: published.document.document_version,
              lecturePublicId: 'lecture_1234567890abcdef',
            },
          ],
          nextOffset: 1,
          ok: true,
        }),
      secret: 'test-retention-secret-at-least-thirty-two-bytes',
      textStore,
    })
    assert.equal(updated, 1)
    assert.equal(
      await textStore.cleanupDue(new Date('2026-08-19T23:59:59.999Z')),
      0,
    )
    assert.equal(
      await textStore.cleanupDue(new Date('2026-08-20T00:00:00.000Z')),
      1,
    )
    await assert.rejects(
      readFile(
        join(
          directory,
          'text',
          'lecture_1234567890abcdef',
          `doc-main-${published.document.document_version}.json`,
        ),
      ),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    )
  })
})

test('loopback server rejects hostile Origin and oversized bodies before parsing', async () => {
  await withStores(async ({ objectStore, textStore }) => {
    const configuration = {
      allowedOrigins: new Set(['https://compass.example']),
      audience: 'compass-pdf-worker',
      host: '127.0.0.1' as const,
      issuer: 'compass-supabase',
      port: 0,
      publicJwk: {} as JsonWebKey,
    }
    const { server, sessions } = createPublisherServer({
      configuration,
      objectStore,
      textStore,
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, configuration.host, resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    configuration.port = address.port
    const url = `http://${configuration.host}:${configuration.port}`
    try {
      const healthy = await fetch(`${url}/v1/health`, {
        headers: { Origin: 'https://compass.example' },
      })
      assert.equal(healthy.status, 200)
      assert.equal(
        healthy.headers.get('Access-Control-Allow-Origin'),
        'https://compass.example',
      )
      assert.equal(
        healthy.headers.has('Access-Control-Allow-Credentials'),
        false,
      )

      const invalidSession = await fetch(`${url}/v1/session`, {
        headers: {
          Origin: 'https://compass.example',
          'X-Compass-Publisher-Token': 'invalid',
        },
      })
      assert.equal(invalidSession.status, 401)

      const paired = await fetch(`${url}/v1/pair`, {
        body: JSON.stringify({ pairingCode: sessions.pairingCode }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://compass.example',
        },
        method: 'POST',
      })
      assert.equal(paired.status, 200)
      const pairedBody = (await paired.json()) as {
        sessionToken: string
      }
      const validSession = await fetch(`${url}/v1/session`, {
        headers: {
          Origin: 'https://compass.example',
          'X-Compass-Publisher-Token': pairedBody.sessionToken,
        },
      })
      assert.equal(validSession.status, 200)

      const hostile = await fetch(`${url}/v1/health`, {
        headers: { Origin: 'https://evil.example' },
      })
      assert.equal(hostile.status, 403)

      const oversized = await fetch(`${url}/v1/pair`, {
        body: JSON.stringify({ padding: 'x'.repeat(5_000) }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://compass.example',
        },
        method: 'POST',
      })
      assert.equal(oversized.status, 413)

      const extractionWithoutSession = await fetch(
        `${url}/v1/lectures/lecture_1234567890abcdef/documents/doc-main/versions/${'a'.repeat(64)}/extraction`,
        {
          headers: {
            Origin: 'https://compass.example',
            'X-Compass-Lecture-Token': 'not-a-token',
          },
        },
      )
      assert.equal(extractionWithoutSession.status, 401)
      assert.equal(
        extractionWithoutSession.headers.get('Cache-Control'),
        'no-store',
      )
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})
