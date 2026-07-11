export type LecturePdfAsset = {
  id: string
  pageCount: number
  title: string
  url: string
}

export const lecturePdfAssets = [
  {
    id: 'm4-sample-v1',
    pageCount: 3,
    title: 'Milestone 4 PDF Sync Sample',
    url: '/lecture-assets/m4-sample-v1.pdf',
  },
] as const satisfies readonly LecturePdfAsset[]

export function getLecturePdfAsset(documentId: string | null | undefined) {
  if (!documentId) {
    return null
  }

  return (
    lecturePdfAssets.find((asset) => asset.id === documentId) ?? null
  ) as LecturePdfAsset | null
}
