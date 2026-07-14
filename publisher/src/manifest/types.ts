export type PdfManifestDocument = {
  archive_expires_at: string | null
  byte_size: number
  delete_after: string | null
  display_name: string
  document_id: string
  document_version: string
  download_enabled: boolean
  object_key: string
  page_count: number
  pdf_sha256: string
  text_char_count: number
  text_sha256: string
  visible: boolean
}

export type PdfManifest = {
  access_version: number
  documents: PdfManifestDocument[]
  lecture_public_id: string
  manifest_version: number
  schema_version: 1
  updated_at: string
}

export type PublicPdfManifestDocument = Omit<
  PdfManifestDocument,
  'object_key' | 'pdf_sha256' | 'text_sha256'
>

export type PublicPdfManifest = Omit<PdfManifest, 'documents'> & {
  documents: PublicPdfManifestDocument[]
}
