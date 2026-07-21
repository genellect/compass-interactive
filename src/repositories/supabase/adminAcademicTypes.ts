export type AcademicSourcePolicy =
  | 'auto'
  | 'biomedical_pubmed'
  | 'multidisciplinary_doi'

export type AdminAcademicCandidate = {
  autoRequestId: string | null
  autoRequestStatus: string | null
  educationalValue: string
  needsAutoDispatch: boolean
  qualityScore: number
  question: string
  retryAfterMs: number
  runId: string
  summaryId: string
  windowIndex: number
}

export type AdminAcademicSource = {
  authors: string[]
  doi: string | null
  journal: string
  pmid: string | null
  publicationTypes: string[]
  publicationYear: number
  sourceId: string
  sourceProvider: 'crossref_openalex' | 'pubmed'
  sourceRole: 'context' | 'primary'
  studyType: string
  title: string
}

export type AdminAcademicAnswer = {
  body: {
    answerPoints: Array<{ sourceIds: string[]; text: string }>
    limitations: string[]
  }
  createdAt: string
  id: string
  publication: null | {
    reviewState: 'admin_confirmed' | 'admin_revised' | 'ai_unreviewed'
    visibility: 'hidden' | 'public'
  }
  question: string
  sources: AdminAcademicSource[]
  status: 'awaiting_review' | 'hidden' | 'published' | 'rejected'
}

export type AdminAcademicResults = {
  activeRequests: Array<{
    id: string
    operationId: string | null
    question: string
    status: 'evidence_checking' | 'running'
    updatedAt: string
  }>
  answers: AdminAcademicAnswer[]
  automation: null | {
    enabled: boolean
    expiresAt: string
    runId: string
    sourcePolicy: AcademicSourcePolicy
    status: string
  }
  candidates: AdminAcademicCandidate[]
  control: null | {
    academicAnswerCallsUsed: number
    academicAnswerLimit: number
    budgetLimitMicrousd: number
    status: string
    usedMicrousd: number
  }
}

export type ManageAcademicAnswersRequest =
  | { action: 'status'; adminToken: string; lectureSessionId: string }
  | {
      action: 'cancel'
      adminToken: string
      lectureSessionId: string
      requestId: string
    }
  | {
      action: 'approve' | 'hide' | 'reject'
      adminToken: string
      answerId: string
      lectureSessionId: string
    }
  | {
      action: 'generate'
      adminToken: string
      billingGrant: string
      idempotencyKey: string
      lectureSessionId: string
      question: string
      searchQuery: string
      sourceKind: 'summary_candidate' | 'teacher_selected'
      sourceSummaryId: string | null
      sourcePolicy: AcademicSourcePolicy
    }
  | {
      action: 'generateAuto'
      adminToken: string
      idempotencyKey: string
      lectureSessionId: string
      question: string
      runToken: string
      searchQuery: string
      sourcePolicy: AcademicSourcePolicy
      sourceSummaryId: string
    }
  | {
      action: 'revise'
      adminToken: string
      answerId: string
      lectureSessionId: string
      reason: string | null
      revisionBody: {
        answerPoints: Array<{ sourceIds: string[]; text: string }>
        limitations: string[]
      }
    }
