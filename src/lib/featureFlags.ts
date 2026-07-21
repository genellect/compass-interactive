export const isPhase1SyncProtocolEnabled =
  import.meta.env.VITE_PHASE1_SYNC_PROTOCOL === 'true'

export const isPhase2LectureLifecycleEnabled =
  import.meta.env.VITE_PHASE2_LECTURE_LIFECYCLE === 'true'

export const isPhase3PrivatePdfEnabled =
  import.meta.env.VITE_PHASE3_PRIVATE_PDF === 'true'

export const isPhase4RealtimeCaptionsEnabled =
  isPhase1SyncProtocolEnabled &&
  import.meta.env.VITE_PHASE4_REALTIME_CAPTIONS === 'true'

export const isPhase5MaterialAnalysisEnabled =
  isPhase3PrivatePdfEnabled &&
  import.meta.env.VITE_PHASE5_MATERIAL_ANALYSIS === 'true'

export const isPhase6SummariesEnabled =
  isPhase1SyncProtocolEnabled &&
  import.meta.env.VITE_PHASE6_SUMMARIES === 'true'

export const isPhase65CommentNicknamesEnabled =
  isPhase1SyncProtocolEnabled &&
  import.meta.env.VITE_PHASE6_5_COMMENT_NICKNAMES === 'true'

export const isPhase66UxIntegrationEnabled =
  isPhase1SyncProtocolEnabled &&
  import.meta.env.VITE_PHASE6_6_UX_INTEGRATION === 'true'

export const isPhase68SecurityEnabled =
  isPhase66UxIntegrationEnabled &&
  import.meta.env.VITE_PHASE6_8_SECURITY === 'true'

export const isPhase71ClassroomExtensionsEnabled =
  isPhase1SyncProtocolEnabled &&
  import.meta.env.VITE_PHASE7_1_CLASSROOM_EXTENSIONS === 'true'

export const isPhase72AcademicAnswersEnabled =
  isPhase6SummariesEnabled &&
  import.meta.env.VITE_PHASE7_2_ACADEMIC_ANSWERS === 'true'

export const isPhase725AutoAcademicAnswersEnabled =
  isPhase72AcademicAnswersEnabled &&
  import.meta.env.VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS === 'true'

export const isPhase726BrowserPdfPublishingEnabled =
  isPhase3PrivatePdfEnabled &&
  import.meta.env.VITE_PHASE7_26_BROWSER_PDF_PUBLISHING === 'true'

export const isPhase727JournalClubEnabled =
  isPhase66UxIntegrationEnabled &&
  isPhase68SecurityEnabled &&
  isPhase71ClassroomExtensionsEnabled &&
  isPhase726BrowserPdfPublishingEnabled &&
  import.meta.env.VITE_PHASE7_27_JOURNAL_CLUB === 'true'
