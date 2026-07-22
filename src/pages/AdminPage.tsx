import { useEffect, useState, type FormEvent } from 'react'
import { useCompassState } from '../hooks/useCompassState'
import {
  AdminAiControlPanel,
  AdminAuthPanel,
  AdminJournalClubPreset,
  AdminLectureControl,
  AdminModerationPanel,
  AdminPdfControl,
  AdminPollControl,
  AdminSessionPanel,
} from '../components/AdminWorkspace'
import {
  type AdminLecture,
  type AdminPdfDocument,
  type AdminPoll,
  type AdminPollList,
  type AdminSessionSummary,
  supabaseAdminRepository,
} from '../repositories/supabaseAdminRepository'
import { type DisplayState } from '../repositories/supabaseDisplayStateRepository'
import { getLecturePdfAsset, lecturePdfAssets } from '../pdf/lectureAssets'
import {
  isPhase3PrivatePdfEnabled,
  isPhase4RealtimeCaptionsEnabled,
  isPhase5MaterialAnalysisEnabled,
  isPhase6SummariesEnabled,
  isPhase68SecurityEnabled,
  isPhase72AcademicAnswersEnabled,
  isPhase726BrowserPdfPublishingEnabled,
  isPhase727JournalClubEnabled,
} from '../lib/featureFlags'
import { issuePdfAccessSession } from '../pdf/pdfDelivery'
import { clearAdminPdfExtractionCache } from '../pdf/adminPdfExtraction'
import { PublisherRequestError, publisherClient } from '../pdf/publisherClient'
import { useBrowserPdfPublication } from '../hooks/useBrowserPdfPublication'
import {
  buildAdminPageView,
  makeJoinedLecture,
} from './admin/adminPageViewModel'
import './AdminPage.css'

const ADMIN_SESSION_STORAGE_KEY = 'compass-interactive-admin-authenticated'
const ADMIN_TOKEN_SESSION_STORAGE_KEY = 'compass-interactive-admin-token'
const PUBLISHER_SESSION_STORAGE_KEY =
  'compass-interactive-publisher-session-token'

function restoreAdminSession() {
  return window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === 'true'
}

function restoreAdminToken() {
  return window.sessionStorage.getItem(ADMIN_TOKEN_SESSION_STORAGE_KEY) ?? ''
}

function restorePublisherSessionToken() {
  return window.sessionStorage.getItem(PUBLISHER_SESSION_STORAGE_KEY) ?? ''
}

export function AdminPage() {
  const {
    activeLectureSessionId,
    comments,
    displayState: liveDisplayState,
    displayStateError: liveDisplayStateError,
    hiddenCommentCount,
    hasOlderComments,
    getServerNow,
    isLoadingOlderComments,
    lecture,
    loadOlderComments,
    participantCount,
    refreshComments,
    setOperatorLiveAccess,
    selectLectureSession,
    visibleCommentCount,
  } = useCompassState()
  const [isAuthenticated, setIsAuthenticated] = useState(restoreAdminSession)
  const [adminToken, setAdminToken] = useState(restoreAdminToken)
  const [adminSessions, setAdminSessions] = useState<AdminSessionSummary[]>([])
  const [adminCurrentSessionId, setAdminCurrentSessionId] = useState('')
  const [adminSessionsError, setAdminSessionsError] = useState('')
  const [adminSessionsLoading, setAdminSessionsLoading] = useState(false)
  const [showAdminSessions, setShowAdminSessions] = useState(false)
  const [pin, setPin] = useState('')
  const [authError, setAuthError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [displayState, setDisplayState] = useState<DisplayState | null>(null)
  const [displayStateError, setDisplayStateError] = useState<string | null>(
    null,
  )
  const [displayStateLoading, setDisplayStateLoading] = useState(false)
  const [displayLaunchError, setDisplayLaunchError] = useState<string | null>(
    null,
  )
  const [isOpeningDisplay, setIsOpeningDisplay] = useState(false)
  const [displayPageInput, setDisplayPageInput] = useState('1')
  const [pdfDocumentInput, setPdfDocumentInput] = useState('')
  const [lectures, setLectures] = useState<AdminLecture[]>([])
  const [showLectureHistory, setShowLectureHistory] = useState(false)
  const [lecturesError, setLecturesError] = useState<string | null>(null)
  const [lecturesLoading, setLecturesLoading] = useState(false)
  const [newLectureTitle, setNewLectureTitle] = useState('Journal Club')
  const [newLectureStartsAt, setNewLectureStartsAt] = useState('')
  const [newLectureEndsAt, setNewLectureEndsAt] = useState('')
  const [adminPolls, setAdminPolls] = useState<AdminPoll[]>([])
  const [adminPollsHasMore, setAdminPollsHasMore] = useState(false)
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
  const {
    activeAdminLecture,
    activeJournalClubRun,
    canShowPollHistory,
    journalClubLectureIds,
    orderedLectures,
    visibleAdminPolls,
    visibleLectures,
  } = buildAdminPageView({
    activeLectureSessionId,
    adminPolls,
    adminPollsHasMore,
    lectures,
    showLectureHistory,
    showPollHistory,
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

  useEffect(() => {
    if (!isAuthenticated || !adminToken) {
      setOperatorLiveAccess(null)
      return
    }
    setOperatorLiveAccess({ kind: 'admin', token: adminToken })
    return () => setOperatorLiveAccess(null)
  }, [adminToken, isAuthenticated, setOperatorLiveAccess])

  function fromDatetimeLocalValue(value: string) {
    return value ? new Date(value).toISOString() : null
  }

  function selectAdminLecture(lectureRow: AdminLecture) {
    selectLectureSession(makeJoinedLecture(lectureRow))
    if (!lectureRow.journalClub) return

    resetBrowserPdfPublication()
    setPdfPublicationDraftId(lectureRow.journalClub.expectedDocumentId)
    setPdfDisplayName('260723 JournalClub Presentation')
    setPdfFile(null)
    setPublisherMessage(
      '修正版PDFを選択し、「学生に講義資料を公開する」を押してください。',
    )
  }

  function expireAdminSession() {
    clearLocalAdminSession()
    setAuthError('管理者認証の有効期限が切れました。再度ログインしてください。')
  }

  function handleInvalidAdminSession(error: unknown) {
    if (!(error instanceof Error) || error.message !== 'Invalid Admin session.')
      return false
    expireAdminSession()
    return true
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

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action: 'list',
        adminToken: token,
        includeHistory,
      })
      setLectures(nextLectures)
    } catch (error) {
      if (handleInvalidAdminSession(error)) return
      setLecturesError(
        error instanceof Error
          ? `講義一覧の取得に失敗しました: ${error.message}`
          : '講義一覧の取得に失敗しました。',
      )
    } finally {
      setLecturesLoading(false)
    }
  }

  async function refreshAdminPolls(
    lectureSessionId = activeLectureSessionId,
    token = adminToken,
    includeHistory = showPollHistory,
  ) {
    if (!lectureSessionId || !token) {
      setAdminPolls([])
      setAdminPollsHasMore(false)
      setAdminPollsError(null)
      return false
    }

    setAdminPollsLoading(true)
    setAdminPollsError(null)

    try {
      const effectiveIncludeHistory =
        includeHistory || journalClubLectureIds.has(lectureSessionId)
      const result = await supabaseAdminRepository.managePolls({
        action: 'list',
        adminToken: token,
        includeHistory: effectiveIncludeHistory,
        lectureSessionId,
      })
      applyAdminPollList(result)
      return true
    } catch (error) {
      if (handleInvalidAdminSession(error)) return false
      setAdminPollsError(
        error instanceof Error
          ? `投票一覧の取得に失敗しました: ${error.message}`
          : '投票一覧の取得に失敗しました。',
      )
      return false
    } finally {
      setAdminPollsLoading(false)
    }
  }

  function applyAdminPollList(result: AdminPollList) {
    setAdminPolls(result.polls)
    setAdminPollsHasMore(result.hasMore)
  }

  async function refreshAdminPdfDocuments(
    lectureSessionId = activeLectureSessionId,
    token = adminToken,
  ) {
    if (!isPhase3PrivatePdfEnabled || !lectureSessionId || !token) {
      setAdminPdfDocuments([])
      return
    }
    try {
      setAdminPdfDocuments(
        await supabaseAdminRepository.managePdfDocuments({
          action: 'list',
          adminToken: token,
          lectureSessionId,
        }),
      )
    } catch (error) {
      setPublisherMessage(
        error instanceof Error
          ? `資料一覧を取得できませんでした: ${error.message}`
          : '資料一覧を取得できませんでした。',
      )
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
            setPublisherMessage(
              '接続の有効期限が切れました。資料公開アプリを再起動し、新しい8桁コードを入力してください。',
            )
            return
          }
          throw error
        }
      }
      setPublisherStatus(publisherSessionToken ? 'paired' : 'connected')
      setPublisherMessage(
        publisherSessionToken
          ? '講義資料を公開できます。'
          : '初回接続の確認が必要です。教員PCに表示された8桁コードを入力してください。',
      )
    } catch {
      setPublisherStatus('disconnected')
      setPublisherMessage(
        '講義資料の公開機能を確認できません。教員PCで資料公開アプリを起動してください。',
      )
    }
  }

  async function publishPdfDocumentWithLocalPublisher() {
    if (!activeLectureSessionId || !adminToken) {
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
        lectureSessionId: activeLectureSessionId,
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
        lectureSessionId: activeLectureSessionId,
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
      const displayUpdated = await updateDisplayState('setDocument', {
        pdfDocumentId: published.document.documentId,
      })
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
        setPublisherMessage(
          '接続の有効期限が切れました。資料公開アプリを再起動し、新しい8桁コードを入力してください。',
        )
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
    if (isPhase726BrowserPdfPublishingEnabled) {
      await publishPdfDocumentInBrowser()
      return
    }
    await publishPdfDocumentWithLocalPublisher()
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsVerifying(true)
    setAuthError('')

    try {
      const verifiedAdminToken =
        await supabaseAdminRepository.verifyAdminPin(pin)
      window.sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'true')
      window.sessionStorage.setItem(
        ADMIN_TOKEN_SESSION_STORAGE_KEY,
        verifiedAdminToken,
      )
      setAdminToken(verifiedAdminToken)
      setIsAuthenticated(true)
      setPin('')
      await refreshLectures(verifiedAdminToken)
    } catch {
      setAuthError('PINを確認できませんでした。入力内容を確認してください。')
    } finally {
      setIsVerifying(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated || !adminToken) {
      setLectures([])
      setLecturesError(null)
      return
    }

    void refreshLectures(adminToken)
  }, [adminToken, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !adminToken || !activeLectureSessionId) {
      setAdminPolls([])
      setAdminPollsHasMore(false)
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
              setPublisherMessage(
                '接続の有効期限が切れました。資料公開アプリを再起動し、新しい8桁コードを入力してください。',
              )
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
            : '初回接続の確認が必要です。教員PCに表示された8桁コードを入力してください。',
        )
      })
      .catch((error) => {
        if (!active) return
        if (error instanceof PublisherRequestError && error.status === 401) {
          window.sessionStorage.removeItem(PUBLISHER_SESSION_STORAGE_KEY)
          setPublisherSessionToken('')
          setPublisherStatus('connected')
          setPublisherMessage(
            '接続の有効期限が切れました。資料公開アプリを再起動し、新しい8桁コードを入力してください。',
          )
          return
        }
        setPublisherStatus('disconnected')
        setPublisherMessage(
          '講義資料の公開機能を確認できません。教員PCで資料公開アプリを起動してください。',
        )
      })
    return () => {
      active = false
    }
  }, [isAuthenticated, publisherSessionToken])

  function clearLocalAdminSession() {
    clearAdminPdfExtractionCache()
    window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
    window.sessionStorage.removeItem(ADMIN_TOKEN_SESSION_STORAGE_KEY)
    setIsAuthenticated(false)
    setAdminToken('')
    setPin('')
    setAdminPolls([])
    setAdminPollsHasMore(false)
    setAdminPollsError(null)
    setAdminPdfDocuments([])
    setAdminSessions([])
    setAdminCurrentSessionId('')
    setPublisherStatus(publisherSessionToken ? 'paired' : 'disconnected')
    setPublisherMessage('')
    resetBrowserPdfPublication()
  }

  async function handleLogout() {
    try {
      if (isPhase68SecurityEnabled && adminToken) {
        await supabaseAdminRepository.manageAdminSessions({
          action: 'logout',
          adminToken,
        })
      }
    } catch {
      // Local logout is fail-safe even when the revoke request times out.
    } finally {
      clearLocalAdminSession()
    }
  }

  async function refreshAdminSessions() {
    if (!adminToken || !isPhase68SecurityEnabled) return
    setAdminSessionsLoading(true)
    setAdminSessionsError('')
    try {
      const result = await supabaseAdminRepository.manageAdminSessions({
        action: 'list',
        adminToken,
      })
      setAdminSessions(result.sessions)
      setAdminCurrentSessionId(result.currentSessionId ?? '')
    } catch {
      setAdminSessionsError('管理セッションを確認できませんでした。')
    } finally {
      setAdminSessionsLoading(false)
    }
  }

  async function revokeAdminSession(sessionId: string) {
    if (!adminToken) return
    setAdminSessionsLoading(true)
    setAdminSessionsError('')
    try {
      await supabaseAdminRepository.manageAdminSessions({
        action: 'revoke',
        adminToken,
        sessionId,
      })
      if (sessionId === adminCurrentSessionId) {
        clearLocalAdminSession()
      } else if (adminSessions.some((session) => session.id === sessionId)) {
        await refreshAdminSessions()
      }
    } catch {
      setAdminSessionsError('管理セッションを失効できませんでした。')
      setAdminSessionsLoading(false)
    }
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
      setDisplayPageInput(String(liveDisplayState.currentPdfPage))
      setPdfDocumentInput(liveDisplayState.pdfDocumentId ?? '')
    }
  }, [
    activeLectureSessionId,
    isAuthenticated,
    liveDisplayState,
    liveDisplayStateError,
  ])

  async function updateDisplayState(
    action: 'next' | 'previous' | 'goToPage' | 'setDocument',
    options: {
      currentPdfPage?: number
      pdfDocumentId?: string | null
    } = {},
  ) {
    if (!activeLectureSessionId) {
      setDisplayStateError('先に講義へ参加してください。')
      return false
    }

    if (!adminToken) {
      setDisplayStateError(
        '管理者認証の有効期限が切れました。再度ログインしてください。',
      )
      return false
    }

    setDisplayStateLoading(true)
    setDisplayStateError(null)

    try {
      let nextDisplayState: Awaited<
        ReturnType<typeof supabaseAdminRepository.updateDisplayState>
      >
      if (action === 'goToPage') {
        nextDisplayState = await supabaseAdminRepository.updateDisplayState({
          action,
          adminToken,
          currentPdfPage: options.currentPdfPage ?? 1,
          lectureSessionId: activeLectureSessionId,
        })
      } else if (action === 'setDocument') {
        nextDisplayState = await supabaseAdminRepository.updateDisplayState({
          action,
          adminToken,
          lectureSessionId: activeLectureSessionId,
          pdfDocumentId: options.pdfDocumentId ?? null,
        })
      } else {
        nextDisplayState = await supabaseAdminRepository.updateDisplayState({
          action,
          adminToken,
          lectureSessionId: activeLectureSessionId,
        })
      }

      setDisplayState(nextDisplayState)
      setDisplayPageInput(String(nextDisplayState.currentPdfPage))
      setPdfDocumentInput(nextDisplayState.pdfDocumentId ?? '')
      return true
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '表示画面の更新に失敗しました。'

      handleInvalidAdminSession(error)

      setDisplayStateError(
        message === 'Invalid Admin session.'
          ? '管理者認証の有効期限が切れました。再度ログインしてください。'
          : '表示画面の更新に失敗しました。少し時間をおいて再度お試しください。',
      )
      return false
    } finally {
      setDisplayStateLoading(false)
    }
  }

  async function handleCreateLecture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!adminToken) {
      setLecturesError(
        '管理者認証の有効期限が切れました。再度ログインしてください。',
      )
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action: 'create',
        adminToken,
        endsAt: fromDatetimeLocalValue(newLectureEndsAt),
        startsAt: fromDatetimeLocalValue(newLectureStartsAt),
        title: newLectureTitle,
      })
      setLectures(nextLectures)
      const createdLecture = nextLectures[0]
      if (createdLecture) {
        selectAdminLecture(createdLecture)
      }
      setNewLectureTitle('Journal Club')
      setNewLectureStartsAt('')
      setNewLectureEndsAt('')
    } catch (error) {
      if (handleInvalidAdminSession(error)) return
      setLecturesError(
        error instanceof Error
          ? `講義作成に失敗しました: ${error.message}`
          : '講義作成に失敗しました。',
      )
    } finally {
      setLecturesLoading(false)
    }
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
      setLecturesError(
        '管理者認証の有効期限が切れました。再度ログインしてください。',
      )
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action,
        adminToken,
        lectureSessionId,
      })
      setLectures(nextLectures)
      const updatedLecture = nextLectures.find(
        (item) => item.id === lectureSessionId,
      )
      if (updatedLecture && activeLectureSessionId === lectureSessionId) {
        selectLectureSession(makeJoinedLecture(updatedLecture))
        await refreshAdminPolls(lectureSessionId, adminToken)
      }
    } catch (error) {
      if (handleInvalidAdminSession(error)) return
      if (
        error instanceof Error &&
        error.message.includes('Journal Club PDF is not active')
      ) {
        setLecturesError('正本資料を学生に公開してから講義を開始してください。')
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
      setLecturesError(
        '管理者認証の有効期限が切れました。再度ログインしてください。',
      )
      return
    }

    setLecturesLoading(true)
    setLecturesError(null)
    const existingIds = new Set(lectures.map((item) => item.id))

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action: 'duplicate',
        adminToken,
        lectureSessionId,
      })
      setLectures(nextLectures)
      const duplicatedLecture = nextLectures.find(
        (item) => !existingIds.has(item.id),
      )
      if (duplicatedLecture) {
        const startedLectures = await supabaseAdminRepository.manageLectures({
          action: 'start',
          adminToken,
          lectureSessionId: duplicatedLecture.id,
        })
        setLectures(startedLectures)
        const startedLecture =
          startedLectures.find((item) => item.id === duplicatedLecture.id) ??
          duplicatedLecture
        selectLectureSession(makeJoinedLecture(startedLecture))
        setShowLectureHistory(false)
      }
    } catch (error) {
      setLecturesError(
        error instanceof Error
          ? `講義をもう一度開始できませんでした: ${error.message}`
          : '講義をもう一度開始できませんでした。',
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

    setAdminPollsLoading(true)
    setAdminPollsError(null)
    try {
      applyAdminPollList(
        await supabaseAdminRepository.managePolls({
          action: 'create',
          adminToken,
          includeHistory: showPollHistory || Boolean(activeJournalClubRun),
          lectureSessionId: activeLectureSessionId,
          optionLabels,
          question: newPollQuestion.trim(),
          type: newPollType,
        }),
      )
      setNewPollQuestion('')
      setNewPollOptions('賛成\n反対')
    } catch (error) {
      setAdminPollsError(
        error instanceof Error
          ? `投票の作成に失敗しました: ${error.message}`
          : '投票の作成に失敗しました。',
      )
    } finally {
      setAdminPollsLoading(false)
    }
  }

  async function updatePollStatus(poll: AdminPoll) {
    if (!adminToken || !activeLectureSessionId) {
      return
    }

    const action = poll.status === 'open' ? 'close' : 'open'
    setAdminPollsLoading(true)
    setAdminPollsError(null)
    try {
      applyAdminPollList(
        await supabaseAdminRepository.managePolls({
          action,
          adminToken,
          includeHistory: showPollHistory || Boolean(activeJournalClubRun),
          lectureSessionId: activeLectureSessionId,
          pollId: poll.id,
        }),
      )
    } catch (error) {
      setAdminPollsError(
        error instanceof Error
          ? `投票状態の更新に失敗しました: ${error.message}`
          : '投票状態の更新に失敗しました。',
      )
    } finally {
      setAdminPollsLoading(false)
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

  async function openClassroomDisplay() {
    if (
      !adminToken ||
      !activeLectureSessionId ||
      activeAdminLecture?.status !== 'open'
    ) {
      setDisplayLaunchError('開始中の講義を選択してください。')
      return
    }

    const displayWindow = window.open('', '_blank')
    if (!displayWindow) {
      setDisplayLaunchError(
        '共有画面を開けませんでした。ポップアップを許可して再度お試しください。',
      )
      return
    }
    displayWindow.opener = null
    displayWindow.document.title = 'COMPASS 共有画面を準備中'
    displayWindow.document.body.textContent = '共有画面を準備しています…'

    setIsOpeningDisplay(true)
    setDisplayLaunchError(null)
    try {
      const session = await supabaseAdminRepository.issueDisplaySession({
        adminToken,
        lectureSessionId: activeLectureSessionId,
      })
      const fragment = new URLSearchParams({
        code: activeAdminLecture?.lectureCode ?? '',
        lecture: session.lectureSessionId,
        token: session.displayToken,
      })
      displayWindow.location.replace(`/display#${fragment.toString()}`)
    } catch (error) {
      displayWindow.close()
      setDisplayLaunchError(
        error instanceof Error
          ? `共有画面を開けませんでした: ${error.message}`
          : '共有画面を開けませんでした。',
      )
    } finally {
      setIsOpeningDisplay(false)
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

  function handleGoToPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextPage = Number(displayPageInput)

    if (
      !Number.isInteger(nextPage) ||
      nextPage < 1 ||
      !selectedPdfAsset ||
      nextPage > selectedPdfAsset.pageCount
    ) {
      setDisplayStateError(
        selectedPdfAsset
          ? `ページ番号は1〜${selectedPdfAsset.pageCount}で入力してください。`
          : '先にPDF資料を選択してください。',
      )
      return
    }

    void updateDisplayState('goToPage', { currentPdfPage: nextPage })
  }

  if (!isAuthenticated) {
    return (
      <AdminAuthPanel
        authError={authError}
        isVerifying={isVerifying}
        onPinChange={setPin}
        onSubmit={handleLogin}
        pin={pin}
      />
    )
  }

  return (
    <main className="page-shell">
      <section className="page-header">
        <div>
          <p className="eyebrow">LECTURE CONTROL</p>
          <h1>{lecture.title}</h1>
          <p>講義の流れと、教室の反応をひとつの画面で。</p>
        </div>
        <div className="admin-actions">
          <button
            className="secondary-button"
            disabled={
              isOpeningDisplay ||
              !activeLectureSessionId ||
              activeAdminLecture?.status !== 'open'
            }
            onClick={() => void openClassroomDisplay()}
            type="button"
          >
            {isOpeningDisplay ? '共有画面を準備中…' : '共有画面を開く'}
          </button>
          <button
            className="secondary-button"
            onClick={() => void handleLogout()}
            type="button"
          >
            ログアウト
          </button>
          {isPhase68SecurityEnabled ? (
            <button
              className="secondary-button"
              onClick={() => {
                const next = !showAdminSessions
                setShowAdminSessions(next)
                if (next) void refreshAdminSessions()
              }}
              type="button"
            >
              セッション管理
            </button>
          ) : null}
        </div>
      </section>
      {displayLaunchError ? (
        <p className="error-note">{displayLaunchError}</p>
      ) : null}
      {showAdminSessions && isPhase68SecurityEnabled ? (
        <AdminSessionPanel
          currentSessionId={adminCurrentSessionId}
          error={adminSessionsError}
          isLoading={adminSessionsLoading}
          onRevoke={(sessionId) => void revokeAdminSession(sessionId)}
          sessions={adminSessions}
        />
      ) : null}

      <nav className="admin-workflow" aria-label="講義運営の流れ">
        <a href="#admin-prepare">
          <span>1</span>
          <strong>準備</strong>
          <small>講義と資料</small>
        </a>
        <a href="#admin-live">
          <span>2</span>
          <strong>講義中</strong>
          <small>投票と共有</small>
        </a>
        <a href="#admin-voices">
          <span>3</span>
          <strong>振り返り</strong>
          <small>みんなの声</small>
        </a>
      </nav>

      <AdminLectureControl
        activeLectureSessionId={activeLectureSessionId}
        error={lecturesError}
        hiddenCommentCount={hiddenCommentCount}
        isLoading={lecturesLoading}
        journalClubPreset={
          isPhase727JournalClubEnabled ? (
            <AdminJournalClubPreset
              adminToken={adminToken}
              isLoading={lecturesLoading}
              lectures={lectures}
              onLoadingChange={setLecturesLoading}
              onPrepared={(preparedLecture, nextLectures) => {
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
        onRefresh={() => void refreshLectures()}
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
        participantCount={participantCount}
        selectedLectureStatus={activeAdminLecture?.status ?? null}
        showHistory={showLectureHistory}
        visibleCommentCount={visibleCommentCount}
        visibleLectures={visibleLectures}
      />

      <AdminPdfControl
        activeLectureSessionId={activeLectureSessionId}
        adminToken={adminToken}
        availableAssets={availablePdfAssets}
        browserPublishingEnabled={isPhase726BrowserPdfPublishingEnabled}
        displayPageInput={displayPageInput}
        displayState={displayState}
        displayStateError={displayStateError}
        displayStateLoading={displayStateLoading}
        lectureStatus={lecture.status}
        onCheckPublisher={() => void checkPublisher()}
        onAbortInterruptedPublication={() =>
          void abortInterruptedPdfPublication()
        }
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
        }}
        onGoToPage={handleGoToPage}
        onNext={() => void updateDisplayState('next')}
        onPageInputChange={setDisplayPageInput}
        onPairingCodeChange={setPublisherPairingCode}
        onPrevious={() => void updateDisplayState('previous')}
        onPublish={() => void publishPdfDocument()}
        onPublishWithLocalPublisher={() =>
          void publishPdfDocumentWithLocalPublisher()
        }
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
        selectedAsset={selectedPdfAsset}
      />

      <AdminAiControlPanel
        activeLecture={activeAdminLecture}
        activeLectureSessionId={activeLectureSessionId}
        adminToken={adminToken}
        academicEnabled={isPhase72AcademicAnswersEnabled}
        displayState={displayState}
        documents={adminPdfDocuments}
        fallbackHardStopAt={lecture.expiresAt}
        getServerNow={getServerNow}
        lectureStatus={lecture.status}
        materialEnabled={isPhase5MaterialAnalysisEnabled}
        onPollDraftCreated={async () => {
          await refreshAdminPolls()
        }}
        publisherSessionToken={publisherSessionToken}
        realtimeEnabled={isPhase4RealtimeCaptionsEnabled}
        summariesEnabled={isPhase6SummariesEnabled}
      />

      <AdminPollControl
        activeLectureSessionId={activeLectureSessionId}
        canShowHistory={canShowPollHistory}
        error={adminPollsError}
        isLoading={adminPollsLoading}
        lectureStatus={lecture.status}
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
          void refreshAdminPolls(activeLectureSessionId, adminToken, true).then(
            (loaded) => {
              if (loaded) setShowPollHistory(true)
            },
          )
        }}
        onTogglePoll={(poll) => void updatePollStatus(poll)}
        onTypeChange={setNewPollType}
        polls={adminPolls}
        showHistory={showPollHistory}
        visiblePolls={visibleAdminPolls}
      />

      <AdminModerationPanel
        comments={comments}
        error={commentModerationError}
        hasOlderComments={hasOlderComments}
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
    </main>
  )
}
