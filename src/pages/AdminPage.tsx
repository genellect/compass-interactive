import { useEffect, useRef, useState, type FormEvent } from 'react'
import { type AdminOperationCredential } from '../lib/adminAuth/adminOperationCredential'
import type { RememberedBrowserIdentityScope } from '../lib/adminAuth/rememberedBrowserCredential'
import { openAdminSurface } from '../lib/adminAuth/adminSurfaceNavigation'
import { AdminPowerPointIntegration } from '../components/AdminWorkspace/AdminPowerPointIntegration'
import { useAdminPowerPointSync } from '../components/AdminWorkspace/useAdminPowerPointSync'
import { useCompassState } from '../hooks/useCompassState'
import {
  AdminAiControlPanel,
  AdminJournalClubPreset,
  AdminLectureControl,
  AdminModerationPanel,
  AdminPdfControl,
  AdminPollControl,
  LectureTransportBar,
  TeacherWorkspaceNav,
} from '../components/AdminWorkspace'
import {
  type AdminLecture,
  type AdminPdfDocument,
  type AdminPoll,
  type AdminPollList,
  supabaseAdminRepository,
} from '../repositories/supabaseAdminRepository'
import { type DisplayState } from '../repositories/supabaseDisplayStateRepository'
import { getLecturePdfAsset, lecturePdfAssets } from '../pdf/lectureAssets'
import {
  isPhase3PrivatePdfEnabled,
  isPhase4RealtimeCaptionsEnabled,
  isPhase5MaterialAnalysisEnabled,
  isPhase6SummariesEnabled,
  isPhase72AcademicAnswersEnabled,
  isPhase726BrowserPdfPublishingEnabled,
  isPhase728JournalClubPresetCreationEnabled,
  isPhase729PowerPointSyncEnabled,
} from '../lib/featureFlags'
import { issuePdfAccessSession } from '../pdf/pdfDelivery'
import { clearAdminPdfExtractionCache } from '../pdf/adminPdfExtraction'
import { PublisherRequestError, publisherClient } from '../pdf/publisherClient'
import { useBrowserPdfPublication } from '../hooks/useBrowserPdfPublication'
import {
  buildAdminPageView,
  deriveTeacherWorkspacePresentation,
  fromDatetimeLocalValue,
  makeJoinedLecture,
  type TeacherWorkspaceView,
} from './admin/adminPageViewModel'
import { useAdminDisplayLauncher } from './admin/useAdminDisplayLauncher'
import { useGoogleAdminWorkspaceSession } from './admin/useGoogleAdminWorkspaceSession'
import { usePublicationDisplayReadback } from './admin/usePublicationDisplayReadback'
import {
  AdminDisplayLaunchButton,
  AdminDisplayLaunchInstructions,
} from './admin/AdminDisplayLaunchControls'
import {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  PUBLISHER_PAIRING_REQUIRED_MESSAGE,
  PUBLISHER_SESSION_EXPIRED_MESSAGE,
  PUBLISHER_UNAVAILABLE_MESSAGE,
} from './admin/adminMessages'
import { useAdminLectureSelectionGuard } from './admin/useAdminLectureSelectionGuard'
import { useAdminPollAutoRefresh } from './admin/useAdminPollAutoRefresh'
import { useAdminPollRefreshCoordinator } from './admin/useAdminPollRefreshCoordinator'
import { useAdminDisplayMutation } from './admin/useAdminDisplayMutation'
import { useAdminDisplayStatus } from './admin/useAdminDisplayStatus'
import {
  PUBLISHER_SESSION_STORAGE_KEY,
  purgeLegacyAdminSessionStorage,
  restorePublisherSessionToken,
} from './admin/adminSessionStorage'
import './AdminPage.css'

export function AdminPage({
  adminCredential,
  canManageEducators,
  identityScope,
  onAdminLogout,
}: {
  adminCredential: AdminOperationCredential
  canManageEducators: boolean
  identityScope: RememberedBrowserIdentityScope
  onAdminLogout: () => Promise<void>
}) {
  const {
    activeLectureSessionId: restoredActiveLectureSessionId,
    clearSelectedLectureSession,
    comments,
    displayState: liveDisplayState,
    displayStateError: liveDisplayStateError,
    hiddenCommentCount,
    hasOlderComments,
    getServerNow,
    isLoadingOlderComments,
    loadOlderComments,
    participantCount,
    refreshComments,
    refreshDisplayState,
    runtimeMode,
    setOperatorLiveAccess,
    selectLectureSession,
    visibleCommentCount,
  } = useCompassState()
  const adminToken = adminCredential
  const isAuthenticated = true
  const [displayState, setDisplayState] = useState<DisplayState | null>(null)
  const [displayStateError, setDisplayStateError] = useState<string | null>(
    null,
  )
  const [pdfDocumentInput, setPdfDocumentInput] = useState('')
  const [lectures, setLectures] = useState<AdminLecture[]>([])
  const [lecturesLoaded, setLecturesLoaded] = useState(false)
  const [showLectureHistory, setShowLectureHistory] = useState(false)
  const [lecturesError, setLecturesError] = useState<string | null>(null)
  const [lecturesLoading, setLecturesLoading] = useState(false)
  const [newLectureTitle, setNewLectureTitle] = useState('')
  const [newLectureStartsAt, setNewLectureStartsAt] = useState('')
  const [newLectureEndsAt, setNewLectureEndsAt] = useState('')
  const [adminPolls, setAdminPolls] = useState<AdminPoll[]>([])
  const [adminPollsHasMore, setAdminPollsHasMore] = useState(false)
  const [adminPollsLectureSessionId, setAdminPollsLectureSessionId] = useState<
    string | null
  >(null)
  const [showPollHistory, setShowPollHistory] = useState(false)
  const [adminPollsError, setAdminPollsError] = useState<string | null>(null)
  const [adminPollsLoading, setAdminPollsLoading] = useState(false)
  const [commentModerationError, setCommentModerationError] = useState<
    string | null
  >(null)
  const [commentModerationPendingId, setCommentModerationPendingId] = useState<
    string | null
  >(null)
  const [newPollQuestion, setNewPollQuestion] = useState('')
  const [newPollType, setNewPollType] = useState<AdminPoll['type']>('single')
  const [newPollOptions, setNewPollOptions] = useState('賛成\n反対')
  const [adminPdfDocuments, setAdminPdfDocuments] = useState<
    AdminPdfDocument[]
  >([])
  const [publisherPairingCode, setPublisherPairingCode] = useState('')
  const [publisherSessionToken, setPublisherSessionToken] = useState(
    restorePublisherSessionToken,
  )
  const [publisherStatus, setPublisherStatus] = useState<
    'checking' | 'connected' | 'disconnected' | 'paired'
  >('disconnected')
  const [publisherMessage, setPublisherMessage] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfDisplayName, setPdfDisplayName] = useState('')
  const [pdfDownloadEnabled, setPdfDownloadEnabled] = useState(true)
  const [pdfPublishing, setPdfPublishing] = useState(false)
  const [workspaceView, setWorkspaceView] =
    useState<TeacherWorkspaceView>('setup')
  const [aiMasterActive, setAiMasterActive] = useState(false)
  const initialRestoredLectureSessionIdRef = useRef(
    runtimeMode === 'live' ? restoredActiveLectureSessionId : null,
  )
  const lectureMutationEpochRef = useRef(0)
  const lectureRefreshSequenceRef = useRef(0)
  const lastWorkspaceLectureIdRef = useRef<string | null>(null)
  const publicationFlowInFlightRef = useRef(false)
  const workspaceSelectionTouchedRef = useRef(false)
  const requestedAdminLectureSessionId =
    runtimeMode === 'live' ? restoredActiveLectureSessionId : null
  const pollsBelongToRequestedLecture =
    adminPollsLectureSessionId === requestedAdminLectureSessionId
  const {
    activeAdminLecture,
    activeJournalClubRun,
    canShowPollHistory,
    journalClubLectureIds,
    orderedLectures,
    visibleAdminPolls,
    visibleLectures,
  } = buildAdminPageView({
    activeLectureSessionId: requestedAdminLectureSessionId,
    adminPolls: pollsBelongToRequestedLecture ? adminPolls : [],
    adminPollsHasMore: pollsBelongToRequestedLecture
      ? adminPollsHasMore
      : false,
    lectures,
    showLectureHistory,
    showPollHistory,
  })
  const activeLectureSessionId = activeAdminLecture?.id ?? null
  const { expireAdminSession, handleInvalidAdminSession, handleLogout } =
    useGoogleAdminWorkspaceSession({
      activeLectureSessionId,
      adminCredential,
      clearLocalWorkspace: clearLocalAdminSession,
      onAdminLogout,
    })
  const { isSending: displayStateLoading, updateDisplayState } =
    useAdminDisplayMutation({
      activeLectureSessionId,
      adminToken,
      handleInvalidAdminSession,
      setDisplayState,
      setDisplayStateError,
      setPdfDocumentInput,
    })
  const {
    beginPollMutation,
    finishPollMutation,
    invalidatePollMutations,
    pollMutationIsCurrent,
    refreshAdminPolls,
  } = useAdminPollRefreshCoordinator({
    activeLectureSessionId,
    adminToken,
    applyPollList: applyAdminPollList,
    clearPollList: () => {
      setAdminPolls([])
      setAdminPollsHasMore(false)
      setAdminPollsLectureSessionId(null)
      setAdminPollsError(null)
    },
    handleInvalidAdminSession,
    journalClubLectureIds,
    setPollsError: setAdminPollsError,
    setPollsLoading: setAdminPollsLoading,
    showPollHistory,
  })
  const { onPublicationActivated, refreshAdminWorkspace } =
    usePublicationDisplayReadback({
      activeLectureSessionId,
      canReadLiveDisplayState: activeAdminLecture?.status === 'open',
      liveDisplayState,
      refreshDisplayState,
      refreshLectures,
      setPublisherMessage,
    })
  const {
    abortInterruptedPdfPublication,
    pdfInterruptedPublicationId,
    pdfPublicationDraftId,
    pdfPublicationRequestId,
    publishPdfDocumentInBrowser,
    resetBrowserPdfPublication,
    setPdfPublicationDraftId,
    setPdfPublicationRequestId,
  } = useBrowserPdfPublication({
    activeLectureSessionId,
    adminToken,
    browserPublishingEnabled: isPhase726BrowserPdfPublishingEnabled,
    isAuthenticated,
    pdfDisplayName,
    pdfDownloadEnabled,
    pdfFile,
    onPublicationActivated,
    requiredDocumentId: activeJournalClubRun?.expectedDocumentId ?? null,
    refreshAdminPdfDocuments,
    setPdfDisplayName,
    setPdfDocumentInput,
    setPdfFile,
    setPdfPublishing,
    setPublisherMessage,
  })
  const availablePdfAssets = isPhase3PrivatePdfEnabled
    ? [
        ...adminPdfDocuments.map((document) => ({
          id: document.documentId,
          pageCount: document.pageCount,
          title: document.displayName,
        })),
        ...(activeJournalClubRun ? [] : lecturePdfAssets),
      ]
    : activeJournalClubRun
      ? []
      : lecturePdfAssets
  const selectedPdfAsset =
    availablePdfAssets.find(
      (asset) => asset.id === displayState?.pdfDocumentId,
    ) ??
    (activeJournalClubRun
      ? null
      : getLecturePdfAsset(displayState?.pdfDocumentId))
  const activePdfPageCount = displayState?.pdfDocumentId
    ? (displayState.pdfPageCount ?? selectedPdfAsset?.pageCount ?? null)
    : null
  const powerpointSync = useAdminPowerPointSync({
    activeLectureSessionId,
    adminToken,
    displayState,
    enabled: isPhase729PowerPointSyncEnabled && runtimeMode === 'live',
    lectureStatus: activeAdminLecture?.status ?? 'draft',
    materialConsentScope: `${identityScope.environmentId}:${identityScope.principalId}:${identityScope.membershipId}`,
    onCommittedPage: () => void refreshDisplayState().catch(() => undefined),
  })
  const canNavigateSlides = Boolean(
    activeLectureSessionId &&
    displayState?.pdfDocumentId &&
    displayState.pdfVisible &&
    activePdfPageCount &&
    !powerpointSync.manualNavigationLocked &&
    activeAdminLecture?.status !== 'closed',
  )
  const {
    copied: displayLinkCopied,
    copyLink: copyClassroomDisplayLink,
    error: displayLaunchError,
    instructionsVisible: displayInstructionsVisible,
    isCopying: isCopyingDisplayLink,
    isOpening: isOpeningDisplay,
    open: openClassroomDisplay,
    replaceLink: replaceClassroomDisplayLink,
  } = useAdminDisplayLauncher({
    activeAdminLecture,
    activeLectureSessionId,
    adminToken,
  })
  const displayIsAvailable =
    Boolean(activeLectureSessionId) && activeAdminLecture?.status === 'open'
  const displayDelivery = useAdminDisplayStatus({
    active: displayIsAvailable,
    adminToken,
    displayStateUpdatedAt: displayState?.updatedAt,
    lectureSessionId: activeLectureSessionId,
  })
  const hasPublishedMaterial = Boolean(
    activeLectureSessionId &&
    displayState?.pdfDocumentId &&
    displayState.pdfVisible,
  )
  const workspacePresentation = deriveTeacherWorkspacePresentation({
    activeLecture: activeAdminLecture,
    hasPublishedMaterial,
  })
  const activeLectureStatus = activeAdminLecture?.status ?? 'draft'
  const { clearPendingSelection, markPendingSelection } =
    useAdminLectureSelectionGuard({
      activeLecture: activeAdminLecture,
      clearSelection: clearSelectedLectureSession,
      lecturesLoaded,
      requestedLectureSessionId: requestedAdminLectureSessionId,
    })

  useEffect(() => {
    const selectedViewIsAvailable =
      workspaceView === 'setup' ||
      (workspaceView === 'slides' && workspacePresentation.canShowSlides) ||
      (workspaceView === 'participation' &&
        workspacePresentation.canShowParticipation) ||
      (workspaceView === 'ai' && workspacePresentation.canShowAi)

    if (lastWorkspaceLectureIdRef.current !== activeLectureSessionId) {
      lastWorkspaceLectureIdRef.current = activeLectureSessionId
      workspaceSelectionTouchedRef.current = false
      setWorkspaceView(workspacePresentation.defaultView)
      return
    }

    if (!selectedViewIsAvailable) {
      // A publication refresh can briefly hide the active PDF document. Let
      // the workspace follow its default again when that state converges so a
      // teacher is not stranded on Setup after explicitly opening Slides.
      workspaceSelectionTouchedRef.current = false
      setWorkspaceView(workspacePresentation.defaultView)
      return
    }

    if (!workspaceSelectionTouchedRef.current) {
      setWorkspaceView(workspacePresentation.defaultView)
    }
  }, [
    activeLectureSessionId,
    workspacePresentation.canShowAi,
    workspacePresentation.canShowParticipation,
    workspacePresentation.canShowSlides,
    workspacePresentation.defaultView,
    workspaceView,
  ])

  useEffect(() => {
    if (!isAuthenticated || !adminToken || runtimeMode !== 'live') {
      setOperatorLiveAccess(null)
      return
    }
    setOperatorLiveAccess({ kind: 'admin', token: adminToken })
    return () => setOperatorLiveAccess(null)
  }, [adminToken, isAuthenticated, runtimeMode, setOperatorLiveAccess])

  function selectAdminLecture(lectureRow: AdminLecture) {
    if (lectureRow.status === 'closed') {
      clearPendingSelection()
      clearSelectedLectureSession()
      workspaceSelectionTouchedRef.current = false
      setWorkspaceView('setup')
      return
    }
    const switchedLecture = Boolean(
      activeLectureSessionId && activeLectureSessionId !== lectureRow.id,
    )
    markPendingSelection(lectureRow.id)
    workspaceSelectionTouchedRef.current = false
    selectLectureSession(makeJoinedLecture(lectureRow))
    setWorkspaceView('setup')
    if (switchedLecture) {
      setPdfFile(null)
    }
    if (!lectureRow.journalClub) return

    resetBrowserPdfPublication()
    setPdfPublicationDraftId(lectureRow.journalClub.expectedDocumentId)
    setPdfDisplayName('260723 JournalClub Presentation')
    if (switchedLecture || !pdfFile) {
      setPublisherMessage(
        '修正版PDFを選択し、「学生に講義資料を公開する」を押してください。',
      )
    }
  }

  async function refreshLectures(
    token = adminToken,
    includeHistory = showLectureHistory,
  ) {
    if (!token) {
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)
    const mutationEpoch = lectureMutationEpochRef.current
    const refreshSequence = ++lectureRefreshSequenceRef.current

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action: 'list',
        adminToken: token,
        includeHistory,
      })
      if (
        mutationEpoch !== lectureMutationEpochRef.current ||
        refreshSequence !== lectureRefreshSequenceRef.current
      ) {
        return
      }
      setLectures(nextLectures)
      setLecturesLoaded(true)
    } catch (error) {
      if (handleInvalidAdminSession(error)) return
      setLecturesError(
        error instanceof Error
          ? `講義一覧の取得に失敗しました: ${error.message}`
          : '講義一覧の取得に失敗しました。',
      )
    } finally {
      if (
        mutationEpoch === lectureMutationEpochRef.current &&
        refreshSequence === lectureRefreshSequenceRef.current
      ) {
        setLecturesLoading(false)
      }
    }
  }

  useAdminPollAutoRefresh({
    enabled: Boolean(
      isAuthenticated &&
      adminToken &&
      !adminPollsLoading &&
      activeLectureSessionId &&
      activeLectureStatus === 'open' &&
      workspaceView === 'participation',
    ),
    refresh: () =>
      refreshAdminPolls(
        activeLectureSessionId,
        adminToken,
        showPollHistory,
        true,
      ),
    refreshKey: `${activeLectureSessionId ?? 'none'}:${showPollHistory}`,
  })

  function applyAdminPollList(
    result: AdminPollList,
    lectureSessionId = activeLectureSessionId,
  ) {
    setAdminPolls(result.polls)
    setAdminPollsHasMore(result.hasMore)
    setAdminPollsLectureSessionId(lectureSessionId)
  }

  async function refreshAdminPdfDocuments(
    lectureSessionId = activeLectureSessionId,
    token = adminToken,
  ) {
    if (!isPhase3PrivatePdfEnabled || !lectureSessionId || !token) {
      setAdminPdfDocuments([])
      return true
    }
    try {
      setAdminPdfDocuments(
        await supabaseAdminRepository.managePdfDocuments({
          action: 'list',
          adminToken: token,
          lectureSessionId,
        }),
      )
      return true
    } catch (error) {
      setPublisherMessage(
        error instanceof Error
          ? `資料一覧を取得できませんでした: ${error.message}`
          : '資料一覧を取得できませんでした。',
      )
      return false
    }
  }

  async function checkPublisher() {
    setPublisherStatus('checking')
    setPublisherMessage('講義資料の公開準備を確認しています…')
    try {
      await publisherClient.health()
      if (publisherSessionToken) {
        try {
          await publisherClient.verifySession(publisherSessionToken)
        } catch (error) {
          if (error instanceof PublisherRequestError && error.status === 401) {
            window.sessionStorage.removeItem(PUBLISHER_SESSION_STORAGE_KEY)
            setPublisherSessionToken('')
            setPublisherStatus('connected')
            setPublisherMessage(PUBLISHER_SESSION_EXPIRED_MESSAGE)
            return
          }
          throw error
        }
      }
      setPublisherStatus(publisherSessionToken ? 'paired' : 'connected')
      setPublisherMessage(
        publisherSessionToken
          ? '講義資料を公開できます。'
          : PUBLISHER_PAIRING_REQUIRED_MESSAGE,
      )
    } catch {
      setPublisherStatus('disconnected')
      setPublisherMessage(PUBLISHER_UNAVAILABLE_MESSAGE)
    }
  }

  async function publishPdfDocumentWithLocalPublisher(
    targetLectureSessionId = activeLectureSessionId,
  ) {
    if (!targetLectureSessionId || !adminToken) {
      setPublisherMessage('先に講義を選択してください。')
      return
    }
    if (!pdfFile) {
      setPublisherMessage('公開するPDFを選択してください。')
      return
    }
    const displayName =
      pdfDisplayName.trim() || pdfFile.name.replace(/\.pdf$/i, '')
    const documentId =
      activeJournalClubRun?.expectedDocumentId ||
      pdfPublicationDraftId ||
      `doc-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
    if (!pdfPublicationDraftId) setPdfPublicationDraftId(documentId)
    setPdfPublishing(true)
    setPublisherMessage('講義資料を確認しています…')
    try {
      let activePublisherToken = publisherSessionToken
      if (!activePublisherToken) {
        if (publisherPairingCode.trim().length !== 8) {
          throw new Error(
            '初回のみ、教員PCに表示された8桁コードを入力してください。',
          )
        }
        const paired = await publisherClient.pair(publisherPairingCode.trim())
        activePublisherToken = paired.sessionToken
        window.sessionStorage.setItem(
          PUBLISHER_SESSION_STORAGE_KEY,
          activePublisherToken,
        )
        setPublisherSessionToken(activePublisherToken)
        setPublisherPairingCode('')
        setPublisherStatus('paired')
      }
      const access = await issuePdfAccessSession({
        adminToken,
        lectureSessionId: targetLectureSessionId,
      })
      setPublisherMessage('学生が閲覧できるように公開しています…')
      const published = await publisherClient.publish({
        accessToken: access.accessToken,
        displayName,
        documentId,
        downloadEnabled: pdfDownloadEnabled,
        file: pdfFile,
        lecturePublicId: access.lecturePublicId,
        publisherSessionToken: activePublisherToken,
      })
      setPublisherMessage('講義画面へ反映しています…')
      const documents = await supabaseAdminRepository.managePdfDocuments({
        action: 'register',
        adminToken,
        byteSize: published.document.byteSize,
        displayName: published.document.displayName,
        documentId: published.document.documentId,
        documentVersion: published.document.documentVersion,
        downloadEnabled: published.document.downloadEnabled,
        expectedAccessVersion: published.accessVersion,
        lectureSessionId: targetLectureSessionId,
        manifestEtag: published.manifestEtag,
        manifestVersion: published.manifestVersion,
        pageCount: published.document.pageCount,
        pdfSha256: published.document.pdfSha256,
        textCharCount: published.document.textCharCount,
        textSha256: published.document.textSha256,
      })
      setAdminPdfDocuments(documents)
      setPdfDocumentInput(published.document.documentId)
      setPdfFile(null)
      setPdfPublicationDraftId(activeJournalClubRun?.expectedDocumentId ?? '')
      setPdfPublicationRequestId('')
      setPdfDisplayName('')
      const displayUpdated = await updateDisplayState(
        'setDocument',
        { pdfDocumentId: published.document.documentId },
        targetLectureSessionId,
      )
      if (!displayUpdated) {
        setPublisherMessage(
          '資料ファイルは公開されましたが、講義画面への表示切替に失敗しました。資料一覧から「この資料を表示」をもう一度押してください。',
        )
        return
      }
      setPublisherMessage(
        `学生への公開が完了しました（${published.document.pageCount}ページ・${(
          published.document.byteSize /
          1024 /
          1024
        ).toFixed(2)}MB）。現在の講義資料として表示しています。`,
      )
    } catch (error) {
      if (error instanceof PublisherRequestError && error.status === 401) {
        window.sessionStorage.removeItem(PUBLISHER_SESSION_STORAGE_KEY)
        setPublisherSessionToken('')
        setPublisherStatus('connected')
        setPublisherMessage(PUBLISHER_SESSION_EXPIRED_MESSAGE)
        return
      }
      setPublisherMessage(
        error instanceof Error
          ? `資料を公開できませんでした。現在の資料は維持されています: ${error.message}`
          : '資料を公開できませんでした。現在の資料は維持されています。',
      )
    } finally {
      setPdfPublishing(false)
    }
  }

  async function publishPdfDocument() {
    if (publicationFlowInFlightRef.current) return
    publicationFlowInFlightRef.current = true
    try {
      let targetLectureSessionId = activeLectureSessionId
      if (!targetLectureSessionId) {
        if (!newLectureTitle.trim()) {
          setPublisherMessage('講義タイトルを入力してください。')
          return
        }
        const createdLecture = await createDraftLecture()
        if (!createdLecture) return
        targetLectureSessionId = createdLecture.id
      }

      if (isPhase726BrowserPdfPublishingEnabled) {
        await publishPdfDocumentInBrowser(targetLectureSessionId)
        return
      }
      await publishPdfDocumentWithLocalPublisher(targetLectureSessionId)
    } finally {
      publicationFlowInFlightRef.current = false
    }
  }

  useEffect(() => {
    if (!isAuthenticated || !adminToken) {
      setLectures([])
      setLecturesError(null)
      setLecturesLoaded(false)
      return
    }

    void refreshLectures(
      adminToken,
      Boolean(initialRestoredLectureSessionIdRef.current),
    )
  }, [adminToken, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !adminToken || !activeLectureSessionId) {
      setAdminPolls([])
      setAdminPollsHasMore(false)
      setAdminPollsLectureSessionId(null)
      setAdminPollsError(null)
      setAdminPdfDocuments([])
      return
    }

    setShowPollHistory(false)
    void refreshAdminPolls(activeLectureSessionId, adminToken, false)
    void refreshAdminPdfDocuments(activeLectureSessionId, adminToken)
  }, [activeLectureSessionId, adminToken, isAuthenticated])

  useEffect(() => {
    if (
      !isAuthenticated ||
      !isPhase3PrivatePdfEnabled ||
      isPhase726BrowserPdfPublishingEnabled
    ) {
      return
    }

    let active = true
    setPublisherStatus('checking')
    setPublisherMessage('講義資料の公開準備を確認しています…')
    void publisherClient
      .health()
      .then(async () => {
        if (!active) return
        if (publisherSessionToken) {
          try {
            await publisherClient.verifySession(publisherSessionToken)
          } catch (error) {
            if (!active) return
            if (
              error instanceof PublisherRequestError &&
              error.status === 401
            ) {
              window.sessionStorage.removeItem(PUBLISHER_SESSION_STORAGE_KEY)
              setPublisherSessionToken('')
              setPublisherStatus('connected')
              setPublisherMessage(PUBLISHER_SESSION_EXPIRED_MESSAGE)
              return
            }
            throw error
          }
        }
        if (!active) return
        setPublisherStatus(publisherSessionToken ? 'paired' : 'connected')
        setPublisherMessage(
          publisherSessionToken
            ? '講義資料を公開できます。'
            : PUBLISHER_PAIRING_REQUIRED_MESSAGE,
        )
      })
      .catch((error) => {
        if (!active) return
        if (error instanceof PublisherRequestError && error.status === 401) {
          window.sessionStorage.removeItem(PUBLISHER_SESSION_STORAGE_KEY)
          setPublisherSessionToken('')
          setPublisherStatus('connected')
          setPublisherMessage(PUBLISHER_SESSION_EXPIRED_MESSAGE)
          return
        }
        setPublisherStatus('disconnected')
        setPublisherMessage(PUBLISHER_UNAVAILABLE_MESSAGE)
      })
    return () => {
      active = false
    }
  }, [isAuthenticated, publisherSessionToken])

  function clearLocalAdminSession() {
    clearAdminPdfExtractionCache()
    // One-time cleanup for browsers that used the removed shared-PIN flow.
    purgeLegacyAdminSessionStorage()
    setAdminPolls([])
    setAdminPollsHasMore(false)
    setAdminPollsLectureSessionId(null)
    setAdminPollsError(null)
    setAdminPdfDocuments([])
    setPublisherStatus(publisherSessionToken ? 'paired' : 'disconnected')
    setPublisherMessage('')
    setAiMasterActive(false)
    setWorkspaceView('setup')
    resetBrowserPdfPublication()
  }

  useEffect(() => {
    if (!isAuthenticated || !activeLectureSessionId) {
      setDisplayState(null)
      setDisplayStateError(null)
      return
    }

    setDisplayState(liveDisplayState)
    setDisplayStateError(liveDisplayStateError)
    if (liveDisplayState) {
      setPdfDocumentInput(liveDisplayState.pdfDocumentId ?? '')
    }
  }, [
    activeLectureSessionId,
    isAuthenticated,
    liveDisplayState,
    liveDisplayStateError,
  ])

  async function createDraftLecture(): Promise<AdminLecture | null> {
    if (!adminToken) {
      setLecturesError(ADMIN_SESSION_EXPIRED_MESSAGE)
      return null
    }

    setLecturesLoading(true)
    setLecturesError(null)
    const mutationEpoch = ++lectureMutationEpochRef.current

    try {
      const result = await supabaseAdminRepository.createLecture({
        adminToken,
        endsAt: fromDatetimeLocalValue(newLectureEndsAt),
        startsAt: fromDatetimeLocalValue(newLectureStartsAt),
        title: newLectureTitle,
      })
      if (mutationEpoch !== lectureMutationEpochRef.current) return null
      const createdLecture = result.lectures.find(
        (lecture) => lecture.id === result.lectureSessionId,
      )
      if (!createdLecture) {
        throw new Error('作成した講義が一覧にありません。')
      }
      setLectures(result.lectures)
      selectAdminLecture(createdLecture)
      setNewLectureTitle('')
      setNewLectureStartsAt('')
      setNewLectureEndsAt('')
      return createdLecture
    } catch (error) {
      if (handleInvalidAdminSession(error)) return null
      setLecturesError(
        error instanceof Error
          ? `講義作成に失敗しました: ${error.message}`
          : '講義作成に失敗しました。',
      )
      return null
    } finally {
      setLecturesLoading(false)
    }
  }

  async function handleCreateLecture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await createDraftLecture()
  }

  async function updateLectureStatus(
    action: 'start' | 'close',
    lectureSessionId: string,
  ) {
    if (
      action === 'close' &&
      !window.confirm(
        '講義を終了します。学生の同期と書き込みが停止します。よろしいですか？',
      )
    ) {
      return
    }

    if (!adminToken) {
      setLecturesError(ADMIN_SESSION_EXPIRED_MESSAGE)
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)
    const mutationEpoch = ++lectureMutationEpochRef.current

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action,
        adminToken,
        lectureSessionId,
      })
      if (mutationEpoch !== lectureMutationEpochRef.current) return
      setLectures(nextLectures)
      const updatedLecture = nextLectures.find(
        (item) => item.id === lectureSessionId,
      )
      if (action === 'close') {
        if (activeLectureSessionId === lectureSessionId) {
          clearPendingSelection()
          clearSelectedLectureSession()
          workspaceSelectionTouchedRef.current = false
          setWorkspaceView('setup')
          setPdfFile(null)
          setPdfDisplayName('')
          setPdfDocumentInput('')
          setPublisherMessage('')
        }
        return
      }
      if (
        updatedLecture &&
        (action === 'start' || activeLectureSessionId === lectureSessionId)
      ) {
        selectLectureSession(makeJoinedLecture(updatedLecture))
        setWorkspaceView(
          action === 'start'
            ? hasPublishedMaterial
              ? 'slides'
              : 'participation'
            : 'setup',
        )
        await refreshAdminPolls(
          lectureSessionId,
          adminToken,
          Boolean(updatedLecture.journalClub),
        )
      }
    } catch (error) {
      if (handleInvalidAdminSession(error)) return
      if (
        error instanceof Error &&
        error.message.includes('Journal Club PDF is not active')
      ) {
        setLecturesError('講義資料を学生に公開してから講義を開始してください。')
        return
      }
      setLecturesError(
        error instanceof Error
          ? `講義状態の更新に失敗しました: ${error.message}`
          : '講義状態の更新に失敗しました。',
      )
    } finally {
      setLecturesLoading(false)
    }
  }

  async function duplicateLecture(lectureSessionId: string) {
    if (!adminToken) {
      setLecturesError(ADMIN_SESSION_EXPIRED_MESSAGE)
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)
    const mutationEpoch = ++lectureMutationEpochRef.current

    try {
      const result = await supabaseAdminRepository.duplicateLecture({
        adminToken,
        lectureSessionId,
      })
      if (mutationEpoch !== lectureMutationEpochRef.current) return
      const duplicatedLecture = result.lectures.find(
        (lecture) => lecture.id === result.lectureSessionId,
      )
      if (!duplicatedLecture) {
        throw new Error('複製した講義が一覧にありません。')
      }
      setLectures(result.lectures)
      selectAdminLecture(duplicatedLecture)
      setWorkspaceView('setup')
      setShowLectureHistory(false)
    } catch (error) {
      setLecturesError(
        error instanceof Error
          ? `講義を準備できませんでした: ${error.message}`
          : '講義を準備できませんでした。',
      )
    } finally {
      setLecturesLoading(false)
    }
  }

  async function handleCreatePoll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!adminToken || !activeLectureSessionId) {
      setAdminPollsError('先に管理対象の講義を選択してください。')
      return
    }

    const optionLabels = newPollOptions
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean)

    if (!newPollQuestion.trim() || optionLabels.length < 2) {
      setAdminPollsError('質問と2件以上の選択肢を入力してください。')
      return
    }

    const lectureSessionId = activeLectureSessionId
    const pollMutation = beginPollMutation(lectureSessionId)
    try {
      const result = await supabaseAdminRepository.managePolls({
        action: 'create',
        adminToken,
        includeHistory: showPollHistory || Boolean(activeJournalClubRun),
        lectureSessionId,
        optionLabels,
        question: newPollQuestion.trim(),
        type: newPollType,
      })
      if (!pollMutationIsCurrent(pollMutation)) return
      applyAdminPollList(result, lectureSessionId)
      setNewPollQuestion('')
      setNewPollOptions('賛成\n反対')
    } catch (error) {
      if (pollMutationIsCurrent(pollMutation)) {
        setAdminPollsError(
          error instanceof Error
            ? `投票の作成に失敗しました: ${error.message}`
            : '投票の作成に失敗しました。',
        )
      }
    } finally {
      finishPollMutation(pollMutation)
    }
  }

  async function updatePollStatus(poll: AdminPoll) {
    if (!adminToken || !activeLectureSessionId) {
      return
    }

    const action = poll.status === 'open' ? 'close' : 'open'
    const lectureSessionId = activeLectureSessionId
    const pollMutation = beginPollMutation(lectureSessionId)
    try {
      const result = await supabaseAdminRepository.managePolls({
        action,
        adminToken,
        includeHistory: showPollHistory || Boolean(activeJournalClubRun),
        lectureSessionId,
        pollId: poll.id,
      })
      if (!pollMutationIsCurrent(pollMutation)) return
      applyAdminPollList(result, lectureSessionId)
    } catch (error) {
      if (pollMutationIsCurrent(pollMutation)) {
        setAdminPollsError(
          error instanceof Error
            ? `投票状態の更新に失敗しました: ${error.message}`
            : '投票状態の更新に失敗しました。',
        )
      }
    } finally {
      finishPollMutation(pollMutation)
    }
  }

  async function copyLectureCode(lectureCode: string) {
    if (!lectureCode) {
      return
    }

    try {
      await navigator.clipboard.writeText(lectureCode)
      setLecturesError(null)
    } catch {
      setLecturesError('講義コードをコピーできませんでした。')
    }
  }

  async function moderateComment(
    commentId: string,
    action: 'togglePin' | 'toggleVisibility',
  ) {
    if (!adminToken || !activeLectureSessionId || commentModerationPendingId) {
      return
    }

    setCommentModerationPendingId(commentId)
    setCommentModerationError(null)
    try {
      await supabaseAdminRepository.moderateComment({
        action,
        adminToken,
        commentId,
        lectureSessionId: activeLectureSessionId,
      })
      await refreshComments()
    } catch (error) {
      setCommentModerationError(
        error instanceof Error
          ? `コメントの更新に失敗しました: ${error.message}`
          : 'コメントの更新に失敗しました。',
      )
    } finally {
      setCommentModerationPendingId(null)
    }
  }

  return (
    <main
      className={`page-shell admin-page-shell ${
        activeLectureSessionId &&
        displayState?.pdfDocumentId &&
        activePdfPageCount
          ? 'has-lecture-transport'
          : ''
      }`}
    >
      <section className="page-header">
        <div>
          <h1>{workspacePresentation.headerTitle}</h1>
          {workspacePresentation.headerDescription ? (
            <p>{workspacePresentation.headerDescription}</p>
          ) : null}
        </div>
        <div className="admin-actions">
          {activeAdminLecture?.status === 'open' ? (
            <button
              className="secondary-button danger-button"
              disabled={lecturesLoading || pdfPublishing}
              onClick={() =>
                void updateLectureStatus('close', activeAdminLecture.id)
              }
              type="button"
            >
              講義を終了
            </button>
          ) : null}
          <AdminDisplayLaunchButton
            isPreparing={isOpeningDisplay}
            lectureIsOpen={displayIsAvailable}
            onPrepare={() => void openClassroomDisplay()}
          />
          <button
            className="secondary-button"
            onClick={() => void handleLogout()}
            type="button"
          >
            ログアウト
          </button>
          {canManageEducators ? (
            <a
              className="secondary-button"
              href="/admin/settings"
              onClick={(event) => {
                event.preventDefault()
                openAdminSurface('/admin/settings')
              }}
              rel="noopener noreferrer"
              target="_blank"
            >
              教員管理
            </a>
          ) : null}
        </div>
      </section>
      <AdminDisplayLaunchInstructions
        copied={displayLinkCopied}
        error={displayLaunchError}
        instructionsVisible={displayInstructionsVisible}
        isCopying={isCopyingDisplayLink}
        isPreparing={isOpeningDisplay}
        lectureIsOpen={displayIsAvailable}
        onCopy={() => void copyClassroomDisplayLink()}
        onReplace={() => void replaceClassroomDisplayLink()}
      />
      <TeacherWorkspaceNav
        activeView={workspaceView}
        aiActive={aiMasterActive}
        canShowAi={workspacePresentation.canShowAi}
        canShowParticipation={workspacePresentation.canShowParticipation}
        canShowSlides={workspacePresentation.canShowSlides}
        onSelect={(view) => {
          workspaceSelectionTouchedRef.current = true
          setWorkspaceView(view)
        }}
      />

      {isPhase729PowerPointSyncEnabled &&
      activeLectureSessionId &&
      displayState?.pdfDocumentId &&
      (workspaceView === 'setup' ||
        !['idle', 'error'].includes(powerpointSync.phase) ||
        powerpointSync.hasConnection) ? (
        <AdminPowerPointIntegration
          activeLectureSessionId={activeLectureSessionId}
          adminToken={adminToken}
          displayState={displayState}
          pdfPageCount={activePdfPageCount}
          pdfTitle={selectedPdfAsset?.title ?? '講義資料'}
          sync={powerpointSync}
          showSetup={workspaceView === 'setup'}
        />
      ) : null}

      {activeLectureSessionId &&
      displayState?.pdfDocumentId &&
      activePdfPageCount ? (
        <LectureTransportBar
          canNavigate={canNavigateSlides}
          currentPage={displayState.currentPdfPage}
          displayPage={displayDelivery.session?.lastRenderedPage ?? null}
          displayStatus={displayDelivery.label}
          displayVersion={
            displayDelivery.session?.lastAppliedDisplayVersion ?? null
          }
          isSending={displayStateLoading}
          onGoToPage={(page) =>
            void updateDisplayState('goToPage', { currentPdfPage: page })
          }
          onNext={() => void updateDisplayState('next')}
          onPrevious={() => void updateDisplayState('previous')}
          pageCount={activePdfPageCount}
        />
      ) : null}

      <section
        aria-labelledby={`teacher-workspace-${
          workspaceView === 'slides' ? 'slides' : 'setup'
        }-tab`}
        className="teacher-workspace-stage teacher-material-stage"
        hidden={workspaceView !== 'setup' && workspaceView !== 'slides'}
        id="teacher-workspace-material"
        role="tabpanel"
      >
        <AdminPdfControl
          activeLectureSessionId={activeLectureSessionId}
          adminToken={adminToken}
          availableAssets={availablePdfAssets}
          browserPublishingEnabled={isPhase726BrowserPdfPublishingEnabled}
          canCreateLectureForPublication={Boolean(newLectureTitle.trim())}
          displayState={displayState}
          displayStateError={displayStateError}
          displayStateLoading={displayStateLoading}
          manualNavigationLocked={powerpointSync.manualNavigationLocked}
          lectureStatus={activeLectureStatus}
          onAbortInterruptedPublication={() =>
            void abortInterruptedPdfPublication()
          }
          onCheckPublisher={() => void checkPublisher()}
          onDisplayNameChange={setPdfDisplayName}
          onDownloadEnabledChange={setPdfDownloadEnabled}
          onFileChange={(file) => {
            setPdfFile(file)
            if (!pdfPublicationRequestId) {
              setPdfPublicationDraftId(
                activeJournalClubRun?.expectedDocumentId ?? '',
              )
            }
            if (file && !pdfDisplayName) {
              setPdfDisplayName(file.name.replace(/\.pdf$/i, ''))
            }
            if (file && !newLectureTitle.trim()) {
              setNewLectureTitle(file.name.replace(/\.pdf$/i, ''))
            }
          }}
          onPairingCodeChange={setPublisherPairingCode}
          onPublish={() => void publishPdfDocument()}
          onSelectDocument={setPdfDocumentInput}
          onSetDocument={() =>
            void updateDisplayState('setDocument', {
              pdfDocumentId: pdfDocumentInput || null,
            })
          }
          pdfDisplayName={pdfDisplayName}
          pdfDocumentInput={pdfDocumentInput}
          pdfDownloadEnabled={pdfDownloadEnabled}
          pdfFile={pdfFile}
          hasInterruptedPublication={Boolean(pdfInterruptedPublicationId)}
          pdfPublishing={pdfPublishing}
          privatePdfEnabled={isPhase3PrivatePdfEnabled}
          publisherMessage={publisherMessage}
          publisherPairingCode={publisherPairingCode}
          publisherSessionToken={publisherSessionToken}
          publisherStatus={publisherStatus}
          requiredDocument={
            activeJournalClubRun
              ? {
                  displayName: '260723 JournalClub Presentation.pdf',
                  documentId: activeJournalClubRun.expectedDocumentId,
                  expectedByteSize: activeJournalClubRun.expectedPdfByteSize,
                  expectedPageCount: activeJournalClubRun.expectedPdfPageCount,
                }
              : null
          }
          view={workspaceView === 'slides' ? 'slides' : 'material'}
        />

        <div className="teacher-setup-stack" hidden={workspaceView !== 'setup'}>
          <AdminLectureControl
            activeLectureSessionId={activeLectureSessionId}
            error={lecturesError}
            hiddenCommentCount={activeLectureSessionId ? hiddenCommentCount : 0}
            isLoading={lecturesLoading || pdfPublishing}
            journalClubPreset={
              isPhase728JournalClubPresetCreationEnabled ? (
                <AdminJournalClubPreset
                  adminToken={adminToken}
                  isLoading={lecturesLoading}
                  lectures={lectures}
                  onLoadingChange={setLecturesLoading}
                  onPrepared={(preparedLecture, nextLectures) => {
                    lectureMutationEpochRef.current += 1
                    setLectures(nextLectures)
                    selectAdminLecture(preparedLecture)
                    setShowLectureHistory(false)
                  }}
                  onSessionExpired={expireAdminSession}
                  selectedRunKind={activeJournalClubRun?.runKind ?? null}
                />
              ) : undefined
            }
            lectures={orderedLectures}
            newEndsAt={newLectureEndsAt}
            newStartsAt={newLectureStartsAt}
            newTitle={newLectureTitle}
            onClose={(lectureSessionId) =>
              void updateLectureStatus('close', lectureSessionId)
            }
            onCopyCode={(lectureCode) => void copyLectureCode(lectureCode)}
            onCreate={handleCreateLecture}
            onDuplicate={(lectureSessionId) =>
              void duplicateLecture(lectureSessionId)
            }
            onEndsAtChange={setNewLectureEndsAt}
            onRefresh={() => void refreshAdminWorkspace()}
            onSelect={selectAdminLecture}
            onStart={(lectureSessionId) =>
              void updateLectureStatus('start', lectureSessionId)
            }
            onStartsAtChange={setNewLectureStartsAt}
            onTitleChange={setNewLectureTitle}
            onToggleHistory={() => {
              if (showLectureHistory) {
                setShowLectureHistory(false)
                return
              }
              void refreshLectures(adminToken, true).then(() =>
                setShowLectureHistory(true),
              )
            }}
            participantCount={activeLectureSessionId ? participantCount : 0}
            selectedLectureStatus={activeAdminLecture?.status ?? null}
            showHistory={showLectureHistory}
            visibleCommentCount={
              activeLectureSessionId ? visibleCommentCount : 0
            }
            visibleLectures={visibleLectures}
          />
        </div>
      </section>

      <section
        aria-labelledby="teacher-workspace-participation-tab"
        className="teacher-workspace-stage"
        hidden={workspaceView !== 'participation'}
        id="teacher-workspace-participation"
        role="tabpanel"
      >
        <AdminPollControl
          activeLectureSessionId={activeLectureSessionId}
          canShowHistory={canShowPollHistory}
          error={adminPollsError}
          isLoading={adminPollsLoading}
          lectureStatus={activeLectureStatus}
          newOptions={newPollOptions}
          newQuestion={newPollQuestion}
          newType={newPollType}
          onCreate={handleCreatePoll}
          onOptionsChange={setNewPollOptions}
          onQuestionChange={setNewPollQuestion}
          onRefresh={() => void refreshAdminPolls()}
          onToggleHistory={() => {
            if (showPollHistory) {
              setShowPollHistory(false)
              return
            }
            void refreshAdminPolls(
              activeLectureSessionId,
              adminToken,
              true,
            ).then((loaded) => {
              if (loaded) setShowPollHistory(true)
            })
          }}
          onTogglePoll={(poll) => void updatePollStatus(poll)}
          onTypeChange={setNewPollType}
          polls={adminPolls}
          showHistory={showPollHistory}
          visiblePolls={visibleAdminPolls}
        />

        {activeLectureStatus === 'open' ? (
          <AdminModerationPanel
            comments={activeLectureSessionId ? comments : []}
            error={commentModerationError}
            hasOlderComments={Boolean(
              activeLectureSessionId && hasOlderComments,
            )}
            isLoadingOlderComments={isLoadingOlderComments}
            onLoadOlderComments={loadOlderComments}
            onTogglePinned={(commentId) =>
              void moderateComment(commentId, 'togglePin')
            }
            onToggleVisibility={(commentId) =>
              void moderateComment(commentId, 'toggleVisibility')
            }
            pendingCommentId={commentModerationPendingId}
          />
        ) : null}
      </section>

      <section
        aria-labelledby="teacher-workspace-ai-tab"
        className="teacher-workspace-stage"
        hidden={workspaceView !== 'ai'}
        id="teacher-workspace-ai"
        role="tabpanel"
      >
        <AdminAiControlPanel
          activeLecture={activeAdminLecture}
          activeLectureSessionId={activeLectureSessionId}
          adminToken={adminToken}
          academicEnabled={isPhase72AcademicAnswersEnabled}
          displayState={displayState}
          documents={adminPdfDocuments}
          fallbackHardStopAt={activeAdminLecture?.hardStopAt}
          fallbackStartedAt={activeAdminLecture?.startsAt}
          getServerNow={getServerNow}
          identityScope={identityScope}
          lectureStatus={activeLectureStatus}
          materialEnabled={isPhase5MaterialAnalysisEnabled}
          onMasterAuthorizationChange={setAiMasterActive}
          onPollDraftCreated={async () => {
            invalidatePollMutations()
            await refreshAdminPolls()
            workspaceSelectionTouchedRef.current = true
            setWorkspaceView('participation')
          }}
          publisherSessionToken={publisherSessionToken}
          realtimeEnabled={isPhase4RealtimeCaptionsEnabled}
          summariesEnabled={isPhase6SummariesEnabled}
        />
      </section>
    </main>
  )
}
