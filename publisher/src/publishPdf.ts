import { createHash } from 'node:crypto'
import {
  DOCUMENT_ID_PATTERN,
  LECTURE_PUBLIC_ID_PATTERN,
  MANIFEST_SCHEMA_VERSION,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARACTERS,
  containsControlCharacters,
} from './constants.ts'
import {
  ConditionalObjectWriteError,
  type PrivateObjectStore,
} from './cloudflare/objectStore.ts'
import {
  decodeManifest,
  encodeManifest,
  parseManifest,
} from './manifest/manifest.ts'
import type { PdfManifest, PdfManifestDocument } from './manifest/types.ts'
import { validatePdf } from './pdf/validatePdf.ts'
import { LocalTextStore } from './storage/localTextStore.ts'

export class ManifestConflictError extends Error {}
export class PublicationVerificationError extends Error {}

const lectureLocks = new Map<string, Promise<unknown>>()

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function verifyManifestEtag(etag: string) {
  if (etag.length < 1 || etag.length > 512 || containsControlCharacters(etag)) {
    throw new PublicationVerificationError(
      'Committed manifest ETag is invalid.',
    )
  }
  return etag
}

export function getManifestKey(lecturePublicId: string) {
  return `manifests/${lecturePublicId}/manifest.json`
}

function getObjectKey(
  lecturePublicId: string,
  documentId: string,
  documentVersion: string,
) {
  return `pdf/${lecturePublicId}/${documentId}/${documentVersion}.pdf`
}

function parseOptionalTimestamp(value: string | null, field: string) {
  if (value === null) return null
  const timestamp = Date.parse(value)
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(`${field} must be an ISO timestamp.`)
  }
  return value
}

function sevenDaysAfter(value: string | null) {
  return value
    ? new Date(Date.parse(value) + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null
}

async function serializeLecture<T>(
  lecturePublicId: string,
  work: () => Promise<T>,
) {
  const previous = lectureLocks.get(lecturePublicId) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  lectureLocks.set(lecturePublicId, queued)
  await previous.catch(() => undefined)
  try {
    return await work()
  } finally {
    release()
    if (lectureLocks.get(lecturePublicId) === queued) {
      lectureLocks.delete(lecturePublicId)
    }
  }
}

export type PublishPdfInput = {
  accessExpiresAt: string | null
  accessVersion: number
  bytes: Uint8Array
  displayName: string
  documentId: string
  downloadEnabled: boolean
  fileName: string
  lecturePublicId: string
  mimeType: string
}

export async function publishPdf(
  input: PublishPdfInput,
  dependencies: {
    now?: () => Date
    objectStore: PrivateObjectStore
    textStore: LocalTextStore
  },
) {
  if (
    !LECTURE_PUBLIC_ID_PATTERN.test(input.lecturePublicId) ||
    !DOCUMENT_ID_PATTERN.test(input.documentId) ||
    !Number.isInteger(input.accessVersion) ||
    input.accessVersion < 1 ||
    input.displayName.trim().length < 1 ||
    input.displayName.length > 160 ||
    containsControlCharacters(input.displayName)
  ) {
    throw new Error('Invalid publication request.')
  }
  const accessExpiresAt = parseOptionalTimestamp(
    input.accessExpiresAt,
    'accessExpiresAt',
  )

  return serializeLecture(input.lecturePublicId, async () => {
    const now = dependencies.now?.() ?? new Date()
    const validated = await validatePdf(input)
    const manifestKey = getManifestKey(input.lecturePublicId)
    const currentObject = await dependencies.objectStore.get(manifestKey)
    const currentManifest = currentObject
      ? decodeManifest(currentObject.bytes)
      : parseManifest({
          access_version: input.accessVersion,
          documents: [],
          lecture_public_id: input.lecturePublicId,
          manifest_version: 0,
          schema_version: MANIFEST_SCHEMA_VERSION,
          updated_at: now.toISOString(),
        })
    if (currentManifest.lecture_public_id !== input.lecturePublicId) {
      throw new ManifestConflictError('Manifest lecture scope does not match.')
    }
    if (
      currentObject &&
      currentManifest.access_version !== input.accessVersion
    ) {
      throw new ManifestConflictError(
        'Manifest access version changed during publication.',
      )
    }

    const existing = currentManifest.documents.find(
      (document) =>
        document.document_id === input.documentId &&
        document.document_version === validated.pdfSha256 &&
        document.visible,
    )
    if (
      currentObject &&
      existing &&
      existing.display_name === input.displayName.trim() &&
      existing.download_enabled === input.downloadEnabled &&
      existing.archive_expires_at === accessExpiresAt &&
      currentManifest.access_version === input.accessVersion
    ) {
      return {
        accessVersion: input.accessVersion,
        document: existing,
        duplicate: true,
        manifestEtag: verifyManifestEtag(currentObject.etag),
        manifestVersion: currentManifest.manifest_version,
      }
    }

    const replacementDocuments = currentManifest.documents.map((document) =>
      document.document_id === input.documentId && document.visible
        ? {
            ...document,
            archive_expires_at: now.toISOString(),
            delete_after: sevenDaysAfter(now.toISOString()),
            visible: false,
          }
        : document,
    )
    const otherVisible = replacementDocuments.filter(
      (document) => document.visible,
    )
    // The v1 manifest/database wire contract uses one as the compatibility
    // count for a textless PDF. Apply that same value to admission so a
    // publication cannot pass the aggregate check and fail after object writes.
    const wireTextCharacterCount = Math.max(1, validated.textCharCount)
    const aggregateBytes =
      otherVisible.reduce((total, document) => total + document.byte_size, 0) +
      validated.byteSize
    const aggregatePages =
      otherVisible.reduce((total, document) => total + document.page_count, 0) +
      validated.pageCount
    const aggregateCharacters =
      otherVisible.reduce(
        (total, document) => total + document.text_char_count,
        0,
      ) + wireTextCharacterCount
    if (
      aggregateBytes > MAX_PDF_BYTES ||
      aggregatePages > MAX_PDF_PAGES ||
      aggregateCharacters > MAX_PDF_TEXT_CHARACTERS
    ) {
      throw new Error('Lecture PDF aggregate limit exceeded.')
    }

    const objectKey = getObjectKey(
      input.lecturePublicId,
      input.documentId,
      validated.pdfSha256,
    )
    const deleteAfter = sevenDaysAfter(accessExpiresAt)
    await dependencies.textStore.save({
      deleteAfter,
      documentId: input.documentId,
      lecturePublicId: input.lecturePublicId,
      validatedPdf: validated,
    })

    let objectHead = await dependencies.objectStore.head(objectKey)
    if (!objectHead) {
      try {
        objectHead = await dependencies.objectStore.put(
          objectKey,
          input.bytes,
          {
            cacheControl: 'private, max-age=31536000, immutable',
            contentDisposition: 'inline',
            contentType: 'application/pdf',
            ifNoneMatch: '*',
            metadata: { sha256: validated.pdfSha256 },
          },
        )
      } catch (error) {
        if (!(error instanceof ConditionalObjectWriteError)) throw error
        objectHead = await dependencies.objectStore.head(objectKey)
      }
    }
    if (
      !objectHead ||
      objectHead.size !== validated.byteSize ||
      objectHead.metadata.sha256 !== validated.pdfSha256
    ) {
      throw new PublicationVerificationError('Published PDF HEAD check failed.')
    }
    const verifiedObject = await dependencies.objectStore.get(objectKey)
    if (
      !verifiedObject ||
      verifiedObject.bytes.byteLength !== validated.byteSize ||
      sha256(verifiedObject.bytes) !== validated.pdfSha256
    ) {
      throw new PublicationVerificationError(
        'Published PDF content verification failed.',
      )
    }

    const nextDocument: PdfManifestDocument = {
      archive_expires_at: accessExpiresAt,
      byte_size: validated.byteSize,
      delete_after: deleteAfter,
      display_name: input.displayName.trim(),
      document_id: input.documentId,
      document_version: validated.pdfSha256,
      download_enabled: input.downloadEnabled,
      object_key: objectKey,
      page_count: validated.pageCount,
      pdf_sha256: validated.pdfSha256,
      // The deployed manifest/database v1 contract requires at least one
      // character. Keep that wire value for textless PDFs while the private
      // extraction records the real zero count and explicit availability.
      text_char_count: wireTextCharacterCount,
      text_sha256: validated.textSha256,
      visible: true,
    }
    const nextManifest: PdfManifest = parseManifest({
      access_version: input.accessVersion,
      documents: [...replacementDocuments, nextDocument],
      lecture_public_id: input.lecturePublicId,
      manifest_version: currentManifest.manifest_version + 1,
      schema_version: MANIFEST_SCHEMA_VERSION,
      updated_at: now.toISOString(),
    })

    try {
      await dependencies.objectStore.put(
        manifestKey,
        encodeManifest(nextManifest),
        {
          cacheControl: 'no-store',
          contentType: 'application/json; charset=utf-8',
          ...(currentObject
            ? { ifMatch: currentObject.etag }
            : { ifNoneMatch: '*' as const }),
        },
      )
    } catch (error) {
      if (error instanceof ConditionalObjectWriteError) {
        throw new ManifestConflictError(
          'Manifest changed during publication. The previous manifest is intact.',
        )
      }
      throw error
    }

    const committed = await dependencies.objectStore.get(manifestKey)
    if (!committed) {
      throw new PublicationVerificationError('Committed manifest is missing.')
    }
    const committedManifest = decodeManifest(committed.bytes)
    if (
      committedManifest.manifest_version !== nextManifest.manifest_version ||
      committedManifest.access_version !== input.accessVersion ||
      !committedManifest.documents.some(
        (document) =>
          document.document_id === nextDocument.document_id &&
          document.document_version === nextDocument.document_version &&
          document.visible,
      )
    ) {
      throw new PublicationVerificationError(
        'Committed manifest verification failed.',
      )
    }

    return {
      accessVersion: input.accessVersion,
      document: nextDocument,
      duplicate: false,
      manifestEtag: verifyManifestEtag(committed.etag),
      manifestVersion: committedManifest.manifest_version,
    }
  })
}
