export type PdfAsset = {
  id: string
  pageCount: number
}

export const pdfAssets = [
  { id: 'm4-sample-v1', pageCount: 3 },
] as const satisfies readonly PdfAsset[]

export function getPdfAsset(documentId: string | null | undefined) {
  if (!documentId) {
    return null
  }

  return pdfAssets.find((asset) => asset.id === documentId) ?? null
}
