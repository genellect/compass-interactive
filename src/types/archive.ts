import type { LiveComment } from './comment'

export type ArchivedPollOption = {
  id: string
  label: string
  order: number
  responseCount: number
}

export type ArchivedPoll = {
  createdAt: string
  id: string
  options: ArchivedPollOption[]
  question: string
  type: 'multiple' | 'single'
}

export type ArchivedPdf = {
  currentPage: number
  displayName: string
  documentId: string
  documentVersion: string
  downloadEnabled: boolean
  lecturePublicId: string
  manifestVersion: number
  pageCount: number
}

export type ArchivedSummary = {
  commentPulse: string[]
  id: string
  lectureRecap: string[]
  pinned: boolean
  publishedAt: string
  reviewState: 'admin_confirmed' | 'admin_revised' | 'ai_unreviewed'
  revisionId: string
  windowEnd: string
  windowIndex: number
  windowStart: string
}

export type ArchivedMaterialSummary = {
  analysisId: string
  body: {
    lead: string
    points: Array<{
      detail?: string
      pageLabel: string
      title: string
    }>
    reflectionQuestion?: string
  }
  publishedAt: string
  reviewState: 'admin_confirmed' | 'admin_revised'
}

export type LectureArchiveSession = {
  archiveAccessToken: string
  archiveAccessTokenExpiresAt: string
  archiveExpiresAt: string
  closedAt: string
  comments: LiveComment[]
  commentsHasMore: boolean
  lookupHash: string
  materialSummary: ArchivedMaterialSummary | null
  participantCountApproximate: number
  pdf: ArchivedPdf | null
  polls: ArchivedPoll[]
  lectureCode: string
  startedAt: string | null
  summaries: ArchivedSummary[]
  title: string
  workerBaseUrl: string
}
