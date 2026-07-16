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
