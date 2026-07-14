import {
  DOCUMENT_ID_PATTERN,
  LECTURE_PUBLIC_ID_PATTERN,
  MANIFEST_SCHEMA_VERSION,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARACTERS,
  SHA256_PATTERN,
  containsControlCharacters,
} from '../constants.ts'
import type {
  PdfManifest,
  PdfManifestDocument,
  PublicPdfManifest,
} from './types.ts'

export class ManifestValidationError extends Error {}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}

function validateOptionalTimestamp(value: unknown, field: string) {
  if (value !== null && !isIsoTimestamp(value)) {
    throw new ManifestValidationError(`${field} must be an ISO timestamp.`)
  }
}

function validateDocument(value: unknown): PdfManifestDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManifestValidationError('Manifest document must be an object.')
  }

  const document = value as Record<string, unknown>
  if (
    typeof document.document_id !== 'string' ||
    !DOCUMENT_ID_PATTERN.test(document.document_id) ||
    typeof document.document_version !== 'string' ||
    !SHA256_PATTERN.test(document.document_version) ||
    document.pdf_sha256 !== document.document_version ||
    typeof document.text_sha256 !== 'string' ||
    !SHA256_PATTERN.test(document.text_sha256) ||
    typeof document.display_name !== 'string' ||
    document.display_name.trim().length < 1 ||
    document.display_name.length > 160 ||
    containsControlCharacters(document.display_name) ||
    !Number.isInteger(document.page_count) ||
    Number(document.page_count) < 1 ||
    Number(document.page_count) > MAX_PDF_PAGES ||
    !Number.isInteger(document.byte_size) ||
    Number(document.byte_size) < 1 ||
    Number(document.byte_size) > MAX_PDF_BYTES ||
    !Number.isInteger(document.text_char_count) ||
    Number(document.text_char_count) < 1 ||
    Number(document.text_char_count) > MAX_PDF_TEXT_CHARACTERS ||
    typeof document.download_enabled !== 'boolean' ||
    typeof document.visible !== 'boolean' ||
    typeof document.object_key !== 'string' ||
    !document.object_key.startsWith('pdf/') ||
    document.object_key.includes('..')
  ) {
    throw new ManifestValidationError('Manifest document is invalid.')
  }

  validateOptionalTimestamp(document.archive_expires_at, 'archive_expires_at')
  validateOptionalTimestamp(document.delete_after, 'delete_after')
  if (
    (document.archive_expires_at === null) !==
    (document.delete_after === null)
  ) {
    throw new ManifestValidationError(
      'archive_expires_at and delete_after must be set together.',
    )
  }

  return document as PdfManifestDocument
}

export function parseManifest(value: unknown): PdfManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManifestValidationError('Manifest must be an object.')
  }

  const manifest = value as Record<string, unknown>
  if (
    manifest.schema_version !== MANIFEST_SCHEMA_VERSION ||
    typeof manifest.lecture_public_id !== 'string' ||
    !LECTURE_PUBLIC_ID_PATTERN.test(manifest.lecture_public_id) ||
    !Number.isInteger(manifest.manifest_version) ||
    Number(manifest.manifest_version) < 0 ||
    !Number.isInteger(manifest.access_version) ||
    Number(manifest.access_version) < 1 ||
    !isIsoTimestamp(manifest.updated_at) ||
    !Array.isArray(manifest.documents)
  ) {
    throw new ManifestValidationError('Manifest header is invalid.')
  }

  const documents = manifest.documents.map(validateDocument)
  const keys = new Set<string>()
  let totalBytes = 0
  let totalPages = 0
  let totalCharacters = 0
  for (const document of documents.filter((candidate) => candidate.visible)) {
    const key = `${document.document_id}:${document.document_version}`
    if (keys.has(key)) {
      throw new ManifestValidationError('Manifest has a duplicate document.')
    }
    keys.add(key)
    totalBytes += document.byte_size
    totalPages += document.page_count
    totalCharacters += document.text_char_count
  }

  if (
    totalBytes > MAX_PDF_BYTES ||
    totalPages > MAX_PDF_PAGES ||
    totalCharacters > MAX_PDF_TEXT_CHARACTERS
  ) {
    throw new ManifestValidationError('Manifest aggregate limits are exceeded.')
  }

  return { ...manifest, documents } as PdfManifest
}

export function decodeManifest(bytes: Uint8Array) {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ManifestValidationError('Manifest JSON is invalid.')
  }
  return parseManifest(value)
}

export function encodeManifest(manifest: PdfManifest) {
  return new TextEncoder().encode(
    `${JSON.stringify(parseManifest(manifest))}\n`,
  )
}

export function toPublicManifest(manifest: PdfManifest): PublicPdfManifest {
  return {
    ...manifest,
    documents: manifest.documents
      .filter((document) => document.visible)
      .map(
        ({
          object_key: _objectKey,
          pdf_sha256: _pdfHash,
          text_sha256: _textHash,
          ...document
        }) => document,
      ),
  }
}
