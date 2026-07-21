export type LecturePdfAsset = {
  id: string
  pageCount: number
  title: string
  url: string
}

export const lecturePdfAssets = [
  {
    id: 'why-learn-english-v1',
    pageCount: 15,
    title: '翻訳できる時代に、なぜ英語を学ぶのか。',
    url: '/lecture-assets/why-learn-english-v1.pdf?v=phase7-25-public',
  },
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
