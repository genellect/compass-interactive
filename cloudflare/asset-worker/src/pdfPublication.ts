import {
  decodeManifest,
  encodeManifest,
  parseManifest,
} from '../../../publisher/src/manifest/manifest.ts'
import type {
  PdfManifest,
  PdfManifestDocument,
} from '../../../publisher/src/manifest/types.ts'
import {
  verifyPdfPublicationToken,
  type PdfPublicationClaims,
} from './crypto.ts'
import type { R2BucketLike, R2ObjectLike } from './r2Types.ts'

type PdfPublicationEnvironment = {
  ALLOWED_ORIGINS: string
  PDF_BUCKET: R2BucketLike
  PDF_PUBLICATION_COORDINATOR_SECRET?: string
  PDF_PUBLICATION_COORDINATOR_URL?: string
  PDF_PUBLICATION_PUBLIC_JWK?: string
  PHASE726_BROWSER_PDF_UPLOAD_ENABLED?: string
}

type PublicationLedger = {
  bytes: number
  committedAt?: string
  createdAt: string
  documentId: string
  generation: number
  lecturePublicId: string
  manifestVersion?: number
  manifestEtag?: string
  objectEtag?: string
  objectKey: string
  pdfSha256: string
  previousAccessVersion?: number
  previousDocumentVersions?: string[]
  publicationId: string
  status: 'active' | 'committed' | 'receiving' | 'rolled_back' | 'uploaded'
  targetAccessVersion?: number
  ticketJti: string
  updatedAt: string
  uploadedAt?: string
}

type CoordinatorResponse = {
  data?: unknown
  idempotent?: boolean
  ok?: boolean
  status?: string
}

type CleanupJob = {
  cleanupClaimId: string
  documentId: string
  lecturePublicId: string
  objectKey: string
  pdfSha256: string
  publicationId: string
  state: 'aborted' | 'expired' | 'retired'
}

const MAX_PDF_BYTES = 15 * 1024 * 1024
const CLEANUP_WORKER_ID = 'cloudflare-asset-worker'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PUBLICATION_PATH =
  /^\/v2\/pdf-publications\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(activate|commit|rollback|status))?$/i

function jsonResponse(
  payload: unknown,
  status: number,
  origin: string | null,
) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  return new Response(`${JSON.stringify(payload)}\n`, { headers, status })
}

function publicationLedgerKey(publicationId: string) {
  return `publication-ledger/${publicationId}.json`
}

function manifestKey(lecturePublicId: string) {
  return `manifests/${lecturePublicId}/manifest.json`
}

function publicationObjectKey(claims: PdfPublicationClaims) {
  return `pdf/${claims.lec}/${claims.doc}/${claims.sha}/${claims.pub}.pdf`
}

function bytesToHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function parsePublicJwk(env: PdfPublicationEnvironment) {
  if (!env.PDF_PUBLICATION_PUBLIC_JWK) {
    throw new Error('Publication verification key is not configured.')
  }
  try {
    const key = JSON.parse(env.PDF_PUBLICATION_PUBLIC_JWK) as JsonWebKey
    if (key.kty !== 'EC' || key.crv !== 'P-256' || typeof key.x !== 'string') {
      throw new Error('invalid')
    }
    return key
  } catch {
    throw new Error('Publication verification key is invalid.')
  }
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('Authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}

async function objectBytes(object: R2ObjectLike) {
  if (object.arrayBuffer) return new Uint8Array(await object.arrayBuffer())
  if (!object.body) throw new Error('R2 object body is missing.')
  return new Uint8Array(await new Response(object.body).arrayBuffer())
}

function parseLedger(value: Uint8Array): PublicationLedger {
  const parsed = JSON.parse(new TextDecoder().decode(value)) as PublicationLedger
  if (
    !parsed ||
    !['active', 'committed', 'receiving', 'rolled_back', 'uploaded'].includes(
      parsed.status,
    ) ||
    typeof parsed.publicationId !== 'string' ||
    typeof parsed.objectKey !== 'string' ||
    !parsed.objectKey.startsWith('pdf/') ||
    typeof parsed.pdfSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(parsed.pdfSha256) ||
    !Number.isSafeInteger(parsed.bytes)
  ) {
    throw new Error('Publication ledger is invalid.')
  }
  return parsed
}

async function loadLedger(
  env: PdfPublicationEnvironment,
  publicationId: string,
) {
  const object = await env.PDF_BUCKET.get(publicationLedgerKey(publicationId))
  if (!object) return null
  return { ledger: parseLedger(await objectBytes(object)), object }
}

async function putLedger(
  env: PdfPublicationEnvironment,
  ledger: PublicationLedger,
  onlyIf: { etagDoesNotMatch?: string; etagMatches?: string },
) {
  return env.PDF_BUCKET.put(
    publicationLedgerKey(ledger.publicationId),
    `${JSON.stringify(ledger)}\n`,
    {
      httpMetadata: {
        cacheControl: 'no-store',
        contentType: 'application/json',
      },
      onlyIf,
    },
  )
}

function assertClaimBinding(
  claims: PdfPublicationClaims,
  publicationId: string,
) {
  if (claims.pub !== publicationId) {
    throw Object.assign(new Error('Publication scope does not match.'), {
      status: 403,
    })
  }
}

function assertLedgerBinding(
  ledger: PublicationLedger,
  claims: PdfPublicationClaims,
) {
  assertLedgerImmutableBinding(ledger, claims)
  if (ledger.generation !== claims.gen) {
    throw Object.assign(new Error('Publication binding does not match.'), {
      status: 409,
    })
  }
}

function assertLedgerImmutableBinding(
  ledger: PublicationLedger,
  claims: PdfPublicationClaims,
) {
  if (
    ledger.publicationId !== claims.pub ||
    ledger.lecturePublicId !== claims.lec ||
    ledger.documentId !== claims.doc ||
    ledger.pdfSha256 !== claims.sha ||
    ledger.bytes !== claims.bytes ||
    ledger.objectKey !== publicationObjectKey(claims)
  ) {
    throw Object.assign(new Error('Publication binding does not match.'), {
      status: 409,
    })
  }
}

async function callCoordinator(
  env: PdfPublicationEnvironment,
  fetcher: typeof fetch,
  payload: Record<string, unknown>,
) {
  const url = env.PDF_PUBLICATION_COORDINATOR_URL
  const secret = env.PDF_PUBLICATION_COORDINATOR_SECRET
  if (!url || !secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('Publication coordinator is not configured.')
  }
  const response = await fetcher(url, {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      'X-Compass-Pdf-Publication-Secret': secret,
    },
    method: 'POST',
    signal: AbortSignal.timeout(5_000),
  })
  let result: CoordinatorResponse = {}
  try {
    result = (await response.json()) as CoordinatorResponse
  } catch {
    // A malformed coordinator response is always fail-closed.
  }
  if (!response.ok || result.ok !== true) {
    throw Object.assign(new Error('Publication coordinator rejected request.'), {
      status: response.status === 409 ? 409 : 503,
    })
  }
  return result
}

function parseCleanupJobs(value: unknown, limit: number): CleanupJob[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error('Publication cleanup claim response is invalid.')
  }
  return value.map((row) => {
    if (!row || typeof row !== 'object') {
      throw new Error('Publication cleanup job is invalid.')
    }
    const candidate = row as Record<string, unknown>
    const publicationId = candidate.publication_id
    const cleanupClaimId = candidate.cleanup_claim_id
    const lecturePublicId = candidate.lecture_public_id
    const documentId = candidate.document_id
    const pdfSha256 = candidate.expected_pdf_sha256
    const objectKey = candidate.object_key
    const state = candidate.state
    if (
      typeof publicationId !== 'string' ||
      !UUID_PATTERN.test(publicationId) ||
      typeof cleanupClaimId !== 'string' ||
      !UUID_PATTERN.test(cleanupClaimId) ||
      typeof lecturePublicId !== 'string' ||
      !/^lecture_[a-z0-9]{16,64}$/.test(lecturePublicId) ||
      typeof documentId !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(documentId) ||
      typeof pdfSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(pdfSha256) ||
      typeof objectKey !== 'string' ||
      objectKey !==
        `pdf/${lecturePublicId}/${documentId}/${pdfSha256}/${publicationId}.pdf` ||
      !['aborted', 'expired', 'retired'].includes(String(state))
    ) {
      throw new Error('Publication cleanup job binding is invalid.')
    }
    return {
      cleanupClaimId,
      documentId,
      lecturePublicId,
      objectKey,
      pdfSha256,
      publicationId,
      state: state as CleanupJob['state'],
    }
  })
}

function createVerifiedPdfStream(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
) {
  let actualBytes = 0
  const prefix: number[] = []
  let magicVerified = false
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    flush() {
      if (!magicVerified || actualBytes !== expectedBytes) {
        throw new Error('PDF byte length or magic is invalid.')
      }
    },
    transform(chunk, controller) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error('PDF stream is invalid.')
      }
      actualBytes += chunk.byteLength
      if (actualBytes > expectedBytes || actualBytes > MAX_PDF_BYTES) {
        throw new Error('PDF byte length is invalid.')
      }
      if (!magicVerified) {
        for (const byte of chunk) {
          if (prefix.length < 5) prefix.push(byte)
          if (prefix.length === 5) break
        }
        if (prefix.length === 5) {
          magicVerified =
            prefix[0] === 0x25 &&
            prefix[1] === 0x50 &&
            prefix[2] === 0x44 &&
            prefix[3] === 0x46 &&
            prefix[4] === 0x2d
          if (!magicVerified) throw new Error('PDF magic is invalid.')
        }
      }
      controller.enqueue(chunk)
    },
  })
  return {
    getActualBytes: () => actualBytes,
    getMagicVerified: () => magicVerified,
    stream: body.pipeThrough(transform),
  }
}

async function verifyStoredObject(
  env: PdfPublicationEnvironment,
  key: string,
  expectedBytes: number,
  expectedSha256: string,
) {
  const head = await env.PDF_BUCKET.head(key)
  if (!head || head.size !== expectedBytes) return null
  const nativeSha = head.checksums?.sha256
    ? bytesToHex(head.checksums.sha256)
    : null
  if (nativeSha !== expectedSha256) return null
  const prefix = await env.PDF_BUCKET.get(key, {
    range: { length: 5, offset: 0 },
  })
  if (!prefix) return null
  const bytes = await objectBytes(prefix)
  if (
    bytes.length !== 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  ) {
    return null
  }
  return head
}

async function handleUpload(
  request: Request,
  env: PdfPublicationEnvironment,
  claims: PdfPublicationClaims,
  origin: string,
  now: Date,
  fetcher: typeof fetch,
) {
  if (claims.purpose !== 'upload') {
    throw Object.assign(new Error('Upload ticket purpose is invalid.'), {
      status: 403,
    })
  }
  if (claims.origin !== origin) {
    throw Object.assign(new Error('Upload Origin does not match ticket.'), {
      status: 403,
    })
  }
  if ((request.headers.get('Content-Type') ?? '').split(';')[0] !== 'application/pdf') {
    throw Object.assign(new Error('Content-Type must be application/pdf.'), {
      status: 415,
    })
  }
  const declaredLength = request.headers.get('Content-Length')
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== claims.bytes)
  ) {
    throw Object.assign(new Error('Content-Length does not match ticket.'), {
      status: 400,
    })
  }
  if (!request.body) {
    throw Object.assign(new Error('PDF body is required.'), { status: 400 })
  }

  let receiving: PublicationLedger
  let claimed: R2ObjectLike
  const existing = await loadLedger(env, claims.pub)
  if (existing) {
    assertLedgerImmutableBinding(existing.ledger, claims)
    if (existing.ledger.generation > claims.gen) {
      throw Object.assign(new Error('Publication upload ticket was already used.'), {
        status: 409,
      })
    }
    if (existing.ledger.generation === claims.gen) {
      if (existing.ledger.ticketJti !== claims.jti) {
        throw Object.assign(
          new Error('Publication upload ticket was already used.'),
          { status: 409 },
        )
      }
      if (
        existing.ledger.status === 'uploaded' ||
        existing.ledger.status === 'committed' ||
        existing.ledger.status === 'active'
      ) {
        const verified = await verifyStoredObject(
          env,
          existing.ledger.objectKey,
          claims.bytes,
          claims.sha,
        )
        if (!verified) throw new Error('Stored publication object is invalid.')
        await callCoordinator(env, fetcher, {
          action: 'recordUploaded',
          actualByteSize: claims.bytes,
          actualPdfSha256: claims.sha,
          generation: claims.gen,
          objectEtag: verified.etag,
          objectKey: existing.ledger.objectKey,
          pdfMagicVerified: true,
          publicationId: claims.pub,
          ticketJti: claims.jti,
          workerAttemptId: claims.jti,
        })
        return jsonResponse(
          { ok: true, publicationId: claims.pub, status: 'uploaded' },
          200,
          origin,
        )
      }
      if (existing.ledger.status !== 'receiving') {
        throw Object.assign(new Error('Publication upload cannot be resumed.'), {
          status: 409,
        })
      }
      const recovered = await recoverReceivingPublication(
        env,
        existing,
        claims,
        now,
        fetcher,
      )
      if (recovered.ledger.status === 'uploaded') {
        return jsonResponse(
          { ok: true, publicationId: claims.pub, status: 'uploaded' },
          200,
          origin,
        )
      }
      receiving = recovered.ledger
      claimed = recovered.object
    } else {
      if (existing.ledger.status !== 'receiving') {
        throw Object.assign(new Error('Stale publication cannot be reissued.'), {
          status: 409,
        })
      }
      await callCoordinator(env, fetcher, {
        action: 'claimNonce',
        allowedOrigin: origin,
        documentId: claims.doc,
        expectedByteSize: claims.bytes,
        expectedPdfSha256: claims.sha,
        generation: claims.gen,
        lecturePublicId: claims.lec,
        nonce: claims.nonce,
        publicationId: claims.pub,
        ticketJti: claims.jti,
        ticketAdminSessionId: claims.sid,
        workerAttemptId: claims.jti,
      })
      const verified = await verifyStoredObject(
        env,
        existing.ledger.objectKey,
        claims.bytes,
        claims.sha,
      )
      const replacement: PublicationLedger = {
        bytes: claims.bytes,
        createdAt: existing.ledger.createdAt,
        documentId: claims.doc,
        generation: claims.gen,
        lecturePublicId: claims.lec,
        objectEtag: verified?.etag,
        objectKey: existing.ledger.objectKey,
        pdfSha256: claims.sha,
        publicationId: claims.pub,
        status: verified ? 'uploaded' : 'receiving',
        ticketJti: claims.jti,
        updatedAt: now.toISOString(),
        uploadedAt: verified ? now.toISOString() : undefined,
      }
      const replaced = await putLedger(env, replacement, {
        etagMatches: existing.object.etag,
      })
      if (!replaced) {
        const current = await loadLedger(env, claims.pub)
        if (!current) {
          throw Object.assign(
            new Error('Publication reissue changed concurrently.'),
            { status: 409 },
          )
        }
        assertLedgerBinding(current.ledger, claims)
        if (current.ledger.ticketJti !== claims.jti) {
          throw Object.assign(
            new Error('Publication reissue changed concurrently.'),
            { status: 409 },
          )
        }
        if (current.ledger.status === 'uploaded') {
          return jsonResponse(
            { ok: true, publicationId: claims.pub, status: 'uploaded' },
            200,
            origin,
          )
        }
        if (current.ledger.status !== 'receiving') {
          throw Object.assign(new Error('Publication cannot be resumed.'), {
            status: 409,
          })
        }
        receiving = current.ledger
        claimed = current.object
      } else if (verified) {
        await callCoordinator(env, fetcher, {
          action: 'recordUploaded',
          actualByteSize: claims.bytes,
          actualPdfSha256: claims.sha,
          generation: claims.gen,
          objectEtag: verified.etag,
          objectKey: replacement.objectKey,
          pdfMagicVerified: true,
          publicationId: claims.pub,
          ticketJti: claims.jti,
          workerAttemptId: claims.jti,
        })
        return jsonResponse(
          { ok: true, publicationId: claims.pub, status: 'uploaded' },
          200,
          origin,
        )
      } else {
        receiving = replacement
        claimed = replaced
      }
    }
  } else {
    await callCoordinator(env, fetcher, {
      action: 'claimNonce',
      allowedOrigin: origin,
      documentId: claims.doc,
      expectedByteSize: claims.bytes,
      expectedPdfSha256: claims.sha,
      generation: claims.gen,
      lecturePublicId: claims.lec,
      nonce: claims.nonce,
      publicationId: claims.pub,
      ticketJti: claims.jti,
      ticketAdminSessionId: claims.sid,
      workerAttemptId: claims.jti,
    })
    const objectKey = publicationObjectKey(claims)
    receiving = {
      bytes: claims.bytes,
      createdAt: now.toISOString(),
      documentId: claims.doc,
      generation: claims.gen,
      lecturePublicId: claims.lec,
      objectKey,
      pdfSha256: claims.sha,
      publicationId: claims.pub,
      status: 'receiving',
      ticketJti: claims.jti,
      updatedAt: now.toISOString(),
    }
    const created = await putLedger(env, receiving, { etagDoesNotMatch: '*' })
    if (!created) {
      throw Object.assign(
        new Error('Publication upload was claimed concurrently.'),
        { status: 409 },
      )
    }
    claimed = created
  }

  const objectKey = receiving.objectKey
  const verifiedStream = createVerifiedPdfStream(
    request.body as ReadableStream<Uint8Array>,
    claims.bytes,
  )
  let stored: R2ObjectLike | null
  let adoptedExistingObject = false
  try {
    stored = await env.PDF_BUCKET.put(objectKey, verifiedStream.stream, {
      customMetadata: {
        pdfSha256: claims.sha,
        publicationId: claims.pub,
      },
      httpMetadata: {
        cacheControl: 'private, no-store',
        contentType: 'application/pdf',
      },
      onlyIf: { etagDoesNotMatch: '*' },
      sha256: claims.sha,
    })
  } catch {
    stored = await verifyStoredObject(env, objectKey, claims.bytes, claims.sha)
    adoptedExistingObject = stored !== null
    if (!stored) {
      const currentLedger = await loadLedger(env, claims.pub)
      if (currentLedger?.object.etag === claimed.etag) {
        await env.PDF_BUCKET.delete(publicationLedgerKey(claims.pub))
      }
      throw Object.assign(new Error('PDF integrity verification failed.'), {
        status: 400,
      })
    }
  }
  if (!stored) {
    stored = await verifyStoredObject(env, objectKey, claims.bytes, claims.sha)
    adoptedExistingObject = stored !== null
  }
  if (
    !stored ||
    (!adoptedExistingObject &&
      (verifiedStream.getActualBytes() !== claims.bytes ||
        !verifiedStream.getMagicVerified()))
  ) {
    if (stored) {
      await env.PDF_BUCKET.delete(objectKey)
    }
    const currentLedger = await loadLedger(env, claims.pub)
    if (currentLedger?.object.etag === claimed.etag) {
      await env.PDF_BUCKET.delete(publicationLedgerKey(claims.pub))
    }
    throw Object.assign(new Error('Immutable PDF upload failed.'), {
      status: stored ? 400 : 409,
    })
  }
  const verified = await verifyStoredObject(
    env,
    objectKey,
    claims.bytes,
    claims.sha,
  )
  if (!verified) {
    await env.PDF_BUCKET.delete(objectKey)
    const currentLedger = await loadLedger(env, claims.pub)
    if (currentLedger?.object.etag === claimed.etag) {
      await env.PDF_BUCKET.delete(publicationLedgerKey(claims.pub))
    }
    throw new Error('Stored PDF integrity verification failed.')
  }
  const uploaded: PublicationLedger = {
    ...receiving,
    objectEtag: verified.etag,
    status: 'uploaded',
    updatedAt: now.toISOString(),
    uploadedAt: now.toISOString(),
  }
  const ledgerUpdated = await putLedger(env, uploaded, {
    etagMatches: claimed.etag,
  })
  if (!ledgerUpdated) {
    throw Object.assign(new Error('Publication ledger changed concurrently.'), {
      status: 409,
    })
  }
  await callCoordinator(env, fetcher, {
    action: 'recordUploaded',
    actualByteSize: claims.bytes,
    actualPdfSha256: claims.sha,
    generation: claims.gen,
    objectEtag: verified.etag,
    objectKey,
    pdfMagicVerified: true,
    publicationId: claims.pub,
    ticketJti: claims.jti,
    workerAttemptId: claims.jti,
  })
  return jsonResponse(
    { ok: true, publicationId: claims.pub, status: 'uploaded' },
    201,
    origin,
  )
}

async function recoverReceivingPublication(
  env: PdfPublicationEnvironment,
  loaded: { ledger: PublicationLedger; object: R2ObjectLike },
  claims: PdfPublicationClaims,
  now: Date,
  fetcher: typeof fetch,
) {
  if (loaded.ledger.status !== 'receiving') return loaded
  const verified = await verifyStoredObject(
    env,
    loaded.ledger.objectKey,
    claims.bytes,
    claims.sha,
  )
  if (!verified) return loaded
  const uploaded: PublicationLedger = {
    ...loaded.ledger,
    objectEtag: verified.etag,
    status: 'uploaded',
    updatedAt: now.toISOString(),
    uploadedAt: now.toISOString(),
  }
  const updated = await putLedger(env, uploaded, {
    etagMatches: loaded.object.etag,
  })
  if (!updated) {
    const current = await loadLedger(env, claims.pub)
    if (!current) {
      throw Object.assign(new Error('Publication recovery changed concurrently.'), {
        status: 409,
      })
    }
    assertLedgerBinding(current.ledger, claims)
    return current
  }
  await callCoordinator(env, fetcher, {
    action: 'recordUploaded',
    actualByteSize: claims.bytes,
    actualPdfSha256: claims.sha,
    generation: claims.gen,
    objectEtag: verified.etag,
    objectKey: loaded.ledger.objectKey,
    pdfMagicVerified: true,
    publicationId: claims.pub,
    ticketJti: loaded.ledger.ticketJti,
    workerAttemptId: loaded.ledger.ticketJti,
  })
  return { ledger: uploaded, object: updated }
}

async function loadManifest(
  env: PdfPublicationEnvironment,
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

async function commitPublication(
  env: PdfPublicationEnvironment,
  claims: PdfPublicationClaims,
  now: Date,
) {
  if (claims.purpose !== 'commit') {
    throw Object.assign(new Error('Commit ticket purpose is invalid.'), {
      status: 403,
    })
  }
  const loadedLedger = await loadLedger(env, claims.pub)
  if (!loadedLedger) {
    throw Object.assign(new Error('Publication upload was not found.'), {
      status: 404,
    })
  }
  assertLedgerBinding(loadedLedger.ledger, claims)
  if (loadedLedger.ledger.status === 'rolled_back') {
    throw Object.assign(new Error('Publication was rolled back.'), {
      status: 409,
    })
  }
  const verified = await verifyStoredObject(
    env,
    loadedLedger.ledger.objectKey,
    claims.bytes,
    claims.sha,
  )
  if (!verified) throw new Error('Stored publication object is invalid.')

  const loadedManifest = await loadManifest(env, claims.lec)
  if (
    !['active', 'committed', 'uploaded'].includes(loadedLedger.ledger.status) ||
    (loadedManifest &&
      loadedManifest.manifest.access_version !== claims.previous_av)
  ) {
    throw Object.assign(new Error('Manifest access-version fence changed.'), {
      status: 409,
    })
  }

  const previousDocuments = loadedManifest?.manifest.documents ?? []
  const stagedDocument = previousDocuments.find(
    (document) =>
      document.document_id === claims.doc &&
      document.document_version === claims.sha,
  )
  if (stagedDocument) {
    if (
      stagedDocument.object_key !== loadedLedger.ledger.objectKey ||
      stagedDocument.byte_size !== claims.bytes ||
      stagedDocument.pdf_sha256 !== claims.sha ||
      stagedDocument.visible !== false ||
      stagedDocument.display_name !== claims.name ||
      stagedDocument.page_count !== claims.pages ||
      stagedDocument.text_char_count !== claims.text_chars ||
      stagedDocument.text_sha256 !== claims.text_sha ||
      stagedDocument.download_enabled !== claims.download ||
      stagedDocument.archive_expires_at !== null ||
      stagedDocument.delete_after !== null
    ) {
      throw Object.assign(new Error('Staged manifest binding changed.'), {
        status: 409,
      })
    }
    const previousDocumentVersions = loadedManifest!.manifest.documents
      .filter(
        (document) =>
          document.document_id === claims.doc &&
          document.document_version !== claims.sha &&
          document.visible,
      )
      .map((document) => document.document_version)
    const committedLedger: PublicationLedger = {
      ...loadedLedger.ledger,
      committedAt: loadedLedger.ledger.committedAt ?? now.toISOString(),
      manifestEtag: loadedManifest!.object.etag,
      manifestVersion: loadedManifest!.manifest.manifest_version,
      previousAccessVersion: claims.previous_av,
      previousDocumentVersions:
        loadedLedger.ledger.previousDocumentVersions ?? previousDocumentVersions,
      status:
        loadedLedger.ledger.status === 'active' ? 'active' : 'committed',
      updatedAt: now.toISOString(),
    }
    if (loadedLedger.ledger.status === 'uploaded') {
      const recovered = await putLedger(env, committedLedger, {
        etagMatches: loadedLedger.object.etag,
      })
      if (!recovered) {
        const current = await loadLedger(env, claims.pub)
        if (
          !current ||
          !['active', 'committed'].includes(current.ledger.status)
        ) {
          throw Object.assign(
            new Error('Publication ledger recovery changed concurrently.'),
            { status: 409 },
          )
        }
        assertLedgerBinding(current.ledger, claims)
        return current.ledger
      }
    }
    return committedLedger
  }
  if (loadedLedger.ledger.status !== 'uploaded') {
    throw Object.assign(new Error('Committed manifest document is missing.'), {
      status: 409,
    })
  }
  const previousDocumentVersions = previousDocuments
    .filter(
      (document) => document.document_id === claims.doc && document.visible,
    )
    .map((document) => document.document_version)
  const nextDocument: PdfManifestDocument = {
    archive_expires_at: null,
    byte_size: claims.bytes,
    delete_after: null,
    display_name: claims.name!,
    document_id: claims.doc,
    document_version: claims.sha,
    download_enabled: claims.download!,
    object_key: loadedLedger.ledger.objectKey,
    page_count: claims.pages!,
    pdf_sha256: claims.sha,
    text_char_count: claims.text_chars!,
    text_sha256: claims.text_sha!,
    visible: false,
  }
  const nextManifest = parseManifest({
    access_version: claims.previous_av,
    documents: [
      ...previousDocuments
        .filter(
          (document) =>
            !(
              document.document_id === claims.doc &&
              document.document_version === claims.sha
            ),
        )
        .map((document) => document),
      nextDocument,
    ],
    lecture_public_id: claims.lec,
    manifest_version: (loadedManifest?.manifest.manifest_version ?? 0) + 1,
    schema_version: 1,
    updated_at: now.toISOString(),
  })
  const committedManifest = await env.PDF_BUCKET.put(
    manifestKey(claims.lec),
    encodeManifest(nextManifest),
    {
      httpMetadata: {
        cacheControl: 'no-store',
        contentType: 'application/json',
      },
      onlyIf: loadedManifest
        ? { etagMatches: loadedManifest.object.etag }
        : { etagDoesNotMatch: '*' },
    },
  )
  if (!committedManifest) {
    throw Object.assign(new Error('Manifest changed concurrently.'), {
      status: 409,
    })
  }
  const committedLedger: PublicationLedger = {
    ...loadedLedger.ledger,
    committedAt: now.toISOString(),
    manifestEtag: committedManifest.etag,
    manifestVersion: nextManifest.manifest_version,
    previousAccessVersion: claims.previous_av,
    previousDocumentVersions,
    status: 'committed',
    updatedAt: now.toISOString(),
  }
  const ledgerUpdated = await putLedger(env, committedLedger, {
    etagMatches: loadedLedger.object.etag,
  })
  if (!ledgerUpdated) {
    throw Object.assign(new Error('Publication ledger changed concurrently.'), {
      status: 409,
    })
  }
  return committedLedger
}

async function activatePublication(
  env: PdfPublicationEnvironment,
  claims: PdfPublicationClaims,
  now: Date,
) {
  if (claims.purpose !== 'activate') {
    throw Object.assign(new Error('Activation ticket purpose is invalid.'), {
      status: 403,
    })
  }
  const loadedLedger = await loadLedger(env, claims.pub)
  if (!loadedLedger) {
    throw Object.assign(new Error('Committed publication was not found.'), {
      status: 404,
    })
  }
  assertLedgerBinding(loadedLedger.ledger, claims)
  if (!['active', 'committed'].includes(loadedLedger.ledger.status)) {
    throw Object.assign(new Error('Publication is not committed.'), {
      status: 409,
    })
  }
  const loadedManifest = await loadManifest(env, claims.lec)
  if (!loadedManifest) throw new Error('Publication manifest is missing.')
  const staged = loadedManifest.manifest.documents.find(
    (document) =>
      document.document_id === claims.doc &&
      document.document_version === claims.sha &&
      document.object_key === loadedLedger.ledger.objectKey,
  )
  if (!staged) {
    throw Object.assign(new Error('Committed manifest document is missing.'), {
      status: 409,
    })
  }
  if (
    loadedManifest.manifest.access_version === claims.target_av &&
    staged.visible
  ) {
    const activeLedger: PublicationLedger = {
      ...loadedLedger.ledger,
      manifestEtag: loadedManifest.object.etag,
      manifestVersion: loadedManifest.manifest.manifest_version,
      previousAccessVersion: claims.previous_av,
      status: 'active',
      targetAccessVersion: claims.target_av,
      updatedAt: now.toISOString(),
    }
    if (loadedLedger.ledger.status !== 'active') {
      const recovered = await putLedger(env, activeLedger, {
        etagMatches: loadedLedger.object.etag,
      })
      if (!recovered) {
        const current = await loadLedger(env, claims.pub)
        if (!current || current.ledger.status !== 'active') {
          throw Object.assign(
            new Error('Publication activation recovery changed concurrently.'),
            { status: 409 },
          )
        }
        assertLedgerBinding(current.ledger, claims)
        return current.ledger
      }
    }
    return activeLedger
  }
  if (
    loadedLedger.ledger.status !== 'committed' ||
    loadedManifest.manifest.access_version !== claims.previous_av ||
    staged.visible
  ) {
    throw Object.assign(new Error('Manifest access-version fence changed.'), {
      status: 409,
    })
  }
  const retiredAt = now.toISOString()
  const deleteAfter = new Date(
    now.getTime() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString()
  const nextManifest = parseManifest({
    ...loadedManifest.manifest,
    access_version: claims.target_av,
    documents: loadedManifest.manifest.documents.map((document) => {
      if (
        document.document_id === claims.doc &&
        document.document_version === claims.sha
      ) {
        return { ...document, visible: true }
      }
      if (document.document_id === claims.doc && document.visible) {
        return {
          ...document,
          archive_expires_at: document.archive_expires_at ?? retiredAt,
          delete_after: document.delete_after ?? deleteAfter,
          visible: false,
        }
      }
      return document
    }),
    manifest_version: loadedManifest.manifest.manifest_version + 1,
    updated_at: now.toISOString(),
  })
  const activatedManifest = await env.PDF_BUCKET.put(
    manifestKey(claims.lec),
    encodeManifest(nextManifest),
    {
      httpMetadata: {
        cacheControl: 'no-store',
        contentType: 'application/json',
      },
      onlyIf: { etagMatches: loadedManifest.object.etag },
    },
  )
  if (!activatedManifest) {
    throw Object.assign(new Error('Manifest changed concurrently.'), {
      status: 409,
    })
  }
  const activeLedger: PublicationLedger = {
    ...loadedLedger.ledger,
    manifestEtag: activatedManifest.etag,
    manifestVersion: nextManifest.manifest_version,
    previousAccessVersion: claims.previous_av,
    status: 'active',
    targetAccessVersion: claims.target_av,
    updatedAt: now.toISOString(),
  }
  const updated = await putLedger(env, activeLedger, {
    etagMatches: loadedLedger.object.etag,
  })
  if (!updated) {
    throw Object.assign(new Error('Publication ledger changed concurrently.'), {
      status: 409,
    })
  }
  return activeLedger
}

async function rollbackPublication(
  env: PdfPublicationEnvironment,
  claims: PdfPublicationClaims,
  now: Date,
) {
  if (claims.purpose !== 'rollback') {
    throw Object.assign(new Error('Rollback ticket purpose is invalid.'), {
      status: 403,
    })
  }
  const loadedLedger = await loadLedger(env, claims.pub)
  if (!loadedLedger) return null
  assertLedgerBinding(loadedLedger.ledger, claims)
  if (loadedLedger.ledger.status === 'rolled_back') return loadedLedger.ledger
  if (!['active', 'committed'].includes(loadedLedger.ledger.status)) {
    throw Object.assign(new Error('Only a staged publication can roll back.'), {
      status: 409,
    })
  }
  const loadedManifest = await loadManifest(env, claims.lec)
  if (!loadedManifest) throw new Error('Publication manifest is missing.')
  const stagedExists = loadedManifest.manifest.documents.some(
    (document) =>
      document.document_id === claims.doc &&
      document.document_version === claims.sha,
  )
  if (
    loadedManifest.manifest.access_version === claims.previous_av &&
    !stagedExists
  ) {
    const rolledBack = {
      ...loadedLedger.ledger,
      status: 'rolled_back' as const,
      updatedAt: now.toISOString(),
    }
    await putLedger(env, rolledBack, {
      etagMatches: loadedLedger.object.etag,
    })
    return rolledBack
  }
  if (
    loadedManifest.manifest.access_version !== claims.target_av &&
    loadedManifest.manifest.access_version !== claims.previous_av
  ) {
    throw Object.assign(new Error('Manifest access-version fence changed.'), {
      status: 409,
    })
  }
  const prior = new Set(loadedLedger.ledger.previousDocumentVersions ?? [])
  const nextManifest: PdfManifest = parseManifest({
    ...loadedManifest.manifest,
    access_version: claims.previous_av,
    documents: loadedManifest.manifest.documents
      .filter(
        (document) =>
          !(
            document.document_id === claims.doc &&
            document.document_version === claims.sha
          ),
      )
      .map((document) =>
        document.document_id === claims.doc &&
        prior.has(document.document_version)
          ? {
              ...document,
              archive_expires_at: null,
              delete_after: null,
              visible: true,
            }
          : document,
      ),
    manifest_version: loadedManifest.manifest.manifest_version + 1,
    updated_at: now.toISOString(),
  })
  const restored = await env.PDF_BUCKET.put(
    manifestKey(claims.lec),
    encodeManifest(nextManifest),
    {
      httpMetadata: {
        cacheControl: 'no-store',
        contentType: 'application/json',
      },
      onlyIf: { etagMatches: loadedManifest.object.etag },
    },
  )
  if (!restored) {
    throw Object.assign(new Error('Manifest changed concurrently.'), {
      status: 409,
    })
  }
  const rolledBack: PublicationLedger = {
    ...loadedLedger.ledger,
    manifestVersion: nextManifest.manifest_version,
    status: 'rolled_back',
    updatedAt: now.toISOString(),
  }
  const updated = await putLedger(env, rolledBack, {
    etagMatches: loadedLedger.object.etag,
  })
  if (!updated) {
    throw Object.assign(new Error('Publication ledger changed concurrently.'), {
      status: 409,
    })
  }
  return rolledBack
}

export async function handlePdfPublicationRequest(input: {
  env: PdfPublicationEnvironment
  fetcher: typeof fetch
  now: Date
  origin: string | null
  request: Request
}): Promise<Response | null> {
  const url = new URL(input.request.url)
  const match = PUBLICATION_PATH.exec(url.pathname)
  if (!match) return null
  if (input.env.PHASE726_BROWSER_PDF_UPLOAD_ENABLED !== 'true') {
    return jsonResponse({ message: 'Not found.' }, 404, input.origin)
  }
  const publicationId = match[1]!
  const operation = match[2] ?? 'upload'
  const claims = await verifyPdfPublicationToken({
    nowSeconds: Math.floor(input.now.getTime() / 1000),
    publicJwk: parsePublicJwk(input.env),
    token: getBearerToken(input.request),
  })
  assertClaimBinding(claims, publicationId)

  if (operation === 'upload' && input.request.method === 'PUT') {
    if (!input.origin) {
      throw Object.assign(new Error('Upload Origin is required.'), {
        status: 403,
      })
    }
    return handleUpload(
      input.request,
      input.env,
      claims,
      input.origin,
      input.now,
      input.fetcher,
    )
  }
  if (operation === 'commit' && input.request.method === 'POST') {
    const ledger = await commitPublication(input.env, claims, input.now)
    return jsonResponse(
      {
        accessVersion: ledger.previousAccessVersion,
        manifestEtag: ledger.manifestEtag,
        manifestVersion: ledger.manifestVersion,
        ok: true,
        publicationId,
        status: 'committed',
      },
      200,
      input.origin,
    )
  }
  if (operation === 'activate' && input.request.method === 'POST') {
    const ledger = await activatePublication(input.env, claims, input.now)
    return jsonResponse(
      {
        accessVersion: ledger.targetAccessVersion,
        manifestEtag: ledger.manifestEtag,
        manifestVersion: ledger.manifestVersion,
        ok: true,
        publicationId,
        status: 'active',
      },
      200,
      input.origin,
    )
  }
  if (operation === 'rollback' && input.request.method === 'POST') {
    const ledger = await rollbackPublication(input.env, claims, input.now)
    return jsonResponse(
      { ok: true, publicationId, status: ledger?.status ?? 'not_found' },
      200,
      input.origin,
    )
  }
  if (operation === 'status' && input.request.method === 'GET') {
    if (claims.purpose !== 'status') {
      throw Object.assign(new Error('Status ticket purpose is invalid.'), {
        status: 403,
      })
    }
    let loaded = await loadLedger(input.env, publicationId)
    if (!loaded) {
      return jsonResponse({ ok: true, publicationId, status: 'pending' }, 200, null)
    }
    assertLedgerBinding(loaded.ledger, claims)
    loaded = await recoverReceivingPublication(
      input.env,
      loaded,
      claims,
      input.now,
      input.fetcher,
    )
    return jsonResponse(
      {
        actualByteSize:
          loaded.ledger.status === 'receiving' ? null : loaded.ledger.bytes,
        actualPdfSha256:
          loaded.ledger.status === 'receiving'
            ? null
            : loaded.ledger.pdfSha256,
        manifestVersion: loaded.ledger.manifestVersion ?? null,
        manifestEtag: loaded.ledger.manifestEtag ?? null,
        objectEtag: loaded.ledger.objectEtag ?? null,
        objectKey: loaded.ledger.objectKey,
        ok: true,
        pdfMagicVerified: loaded.ledger.status !== 'receiving',
        publicationId,
        status: loaded.ledger.status,
        workerAttemptId: loaded.ledger.ticketJti,
      },
      200,
      null,
    )
  }
  return jsonResponse({ message: 'Method not allowed.' }, 405, input.origin)
}

export async function cleanupExpiredPdfPublications(
  env: PdfPublicationEnvironment,
  now = new Date(),
  limit = 25,
  fetcher: typeof fetch = fetch,
) {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
  const claimed = await callCoordinator(env, fetcher, {
    action: 'claimCleanup',
    limit: boundedLimit,
    workerId: CLEANUP_WORKER_ID,
  })
  const jobs = parseCleanupJobs(claimed.data, boundedLimit)
  let deletedLedgers = 0
  let deletedObjects = 0
  let failures = 0
  let completionError: unknown

  for (const job of jobs) {
    let succeeded = false
    let errorCode: string | null = null
    try {
      const loadedLedger = await loadLedger(env, job.publicationId)
      if (loadedLedger) {
        const ledger = loadedLedger.ledger
        if (
          ledger.publicationId !== job.publicationId ||
          ledger.lecturePublicId !== job.lecturePublicId ||
          ledger.documentId !== job.documentId ||
          ledger.pdfSha256 !== job.pdfSha256 ||
          ledger.objectKey !== job.objectKey ||
          (ledger.status === 'active' && job.state !== 'retired')
        ) {
          throw new Error('cleanup_ledger_binding_invalid')
        }
      }

      const loadedManifest = await loadManifest(env, job.lecturePublicId)
      if (loadedManifest) {
        const references = loadedManifest.manifest.documents.filter(
          (document) => document.object_key === job.objectKey,
        )
        if (references.some((document) => document.visible)) {
          throw new Error('cleanup_object_still_visible')
        }
        if (references.length > 0) {
          const nextManifest = parseManifest({
            ...loadedManifest.manifest,
            documents: loadedManifest.manifest.documents.filter(
              (document) => document.object_key !== job.objectKey,
            ),
            manifest_version: loadedManifest.manifest.manifest_version + 1,
            updated_at: now.toISOString(),
          })
          const updated = await env.PDF_BUCKET.put(
            manifestKey(job.lecturePublicId),
            encodeManifest(nextManifest),
            {
              httpMetadata: {
                cacheControl: 'no-store',
                contentType: 'application/json',
              },
              onlyIf: { etagMatches: loadedManifest.object.etag },
            },
          )
          if (!updated) throw new Error('cleanup_manifest_conflict')
        }
      }

      if (await env.PDF_BUCKET.head(job.objectKey)) {
        await env.PDF_BUCKET.delete(job.objectKey)
        if (await env.PDF_BUCKET.head(job.objectKey)) {
          throw new Error('cleanup_object_delete_failed')
        }
        deletedObjects += 1
      }
      if (loadedLedger) {
        await env.PDF_BUCKET.delete(publicationLedgerKey(job.publicationId))
        deletedLedgers += 1
      }
      succeeded = true
    } catch (error) {
      failures += 1
      errorCode =
        error instanceof Error && /^[a-z0-9_:-]{1,80}$/.test(error.message)
          ? error.message
          : 'worker_cleanup_failed'
    }

    try {
      await callCoordinator(env, fetcher, {
        action: 'completeCleanup',
        cleanupClaimId: job.cleanupClaimId,
        errorCode,
        publicationId: job.publicationId,
        succeeded,
        workerId: CLEANUP_WORKER_ID,
      })
    } catch (error) {
      completionError ??= error
    }
  }
  if (completionError) throw completionError
  return {
    deletedLedgers,
    deletedObjects,
    failures,
    scanned: jobs.length,
    skipped: false,
  }
}
