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

// Phase 7.27 data and archive compatibility remain enabled independently from
// the one-off preset creation surface. Missing values intentionally fail
// closed so an old production environment cannot recreate a retired run.
export const isPhase728JournalClubPresetCreationEnabled =
  isPhase727JournalClubEnabled &&
  import.meta.env.VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION === 'true'

// Cross-browser Display Realtime is independent from student live sync. It
// requires tracked Admin sessions and the existing classroom Display surface.
export const isPhase728DisplayRealtimeEnabled =
  isPhase68SecurityEnabled &&
  isPhase71ClassroomExtensionsEnabled &&
  import.meta.env.VITE_PHASE7_28_DISPLAY_REALTIME === 'true'

export const isPhase728AiMasterAuthorizationEnabled =
  isPhase68SecurityEnabled &&
  isPhase4RealtimeCaptionsEnabled &&
  isPhase5MaterialAnalysisEnabled &&
  isPhase6SummariesEnabled &&
  isPhase72AcademicAnswersEnabled &&
  isPhase725AutoAcademicAnswersEnabled &&
  import.meta.env.VITE_PHASE7_28_AI_MASTER_AUTH === 'true'

// PowerPoint integration is additive and fail-closed. It reuses the existing
// private PDF and Display Realtime delivery contracts; students remain on the
// five-second snapshot protocol.
export const isPhase729PowerPointSyncEnabled =
  isPhase3PrivatePdfEnabled &&
  isPhase728DisplayRealtimeEnabled &&
  import.meta.env.VITE_PHASE7_29_POWERPOINT_SYNC === 'true'

// Phase 7.30 B1 is an identity-only, default-OFF preview. It does not grant
// lecture, PDF, AI, Display or Presenter authority before Phase 7.30 C.
export const isPhase730AdminIdentityEnabled =
  import.meta.env.VITE_PHASE7_30_ADMIN_IDENTITY === 'true'

// B2.2b is an identity-shell preview only. It never bridges a browser proof to
// the legacy operational workspace or to lecture AI master authority.
export const isPhase730AdminAiUnlockEnabled =
  isPhase730AdminIdentityEnabled &&
  import.meta.env.VITE_PHASE7_30_ADMIN_AI_UNLOCK === 'true'

// Authenticator factor changes are identity recovery controls, not AI
// authority. Keep their source gate independent from AI eligibility.
export const isPhase730AdminTotpFactorMutationEnabled =
  isPhase730AdminIdentityEnabled &&
  import.meta.env.VITE_PHASE7_30_ADMIN_TOTP_FACTOR_MUTATION === 'true'

// C2 operational authority is a separate dormant transport. It never falls
// back to the legacy shared-PIN credential when the Google path is selected.
export const isPhase730GoogleAdminOperationsEnabled =
  isPhase730AdminIdentityEnabled &&
  import.meta.env.VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS === 'true'

// This flag opens only new/elevating owner-ledger mutations. The owner panel
// remains mounted with Google operations so safe status and revoke controls
// stay available while admission is disabled.
export const isPhase730GoogleAdminLedgerAdmissionEnabled =
  isPhase730GoogleAdminOperationsEnabled &&
  import.meta.env.VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER === 'true'

// Expand-first rollback stays available unless explicitly disabled. The Edge
// and database gates remain authoritative even when this UI branch is shown.
export const isLegacyAdminPinLoginEnabled =
  import.meta.env.VITE_PHASE7_30_LEGACY_ADMIN_PIN !== 'false'
