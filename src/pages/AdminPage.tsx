import { useEffect, useState, type FormEvent } from 'react'
import { LiveBoard } from '../components/LiveBoard'
import { AppIcon } from '../components/AppIcon'
import { useCompassState } from '../hooks/useCompassState'
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
} from '../lib/featureFlags'
import { issuePdfAccessSession } from '../pdf/pdfDelivery'
import { PublisherRequestError, publisherClient } from '../pdf/publisherClient'
import {
  LectureSummaryControl,
  MaterialAnalysisControl,
  RealtimeCaptionControl,
} from '../components/AdminAiControl'
import { SyncedPdfViewer } from '../components/DisplayView/SyncedPdfViewer'
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

function getStatusLabel(status: string) {
  if (status === 'open') {
    return '受付中'
  }

  if (status === 'closed') {
    return '締切'
  }

  return '準備中'
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
  const [pdfPublicationDraftId, setPdfPublicationDraftId] = useState('')
  const [pdfDisplayName, setPdfDisplayName] = useState('')
  const [pdfDownloadEnabled, setPdfDownloadEnabled] = useState(true)
  const [pdfPublishing, setPdfPublishing] = useState(false)
  const availablePdfAssets = isPhase3PrivatePdfEnabled
    ? [
        ...adminPdfDocuments.map((document) => ({
          id: document.documentId,
          pageCount: document.pageCount,
          title: document.displayName,
        })),
        ...lecturePdfAssets,
      ]
    : lecturePdfAssets
  const selectedPdfAsset =
    availablePdfAssets.find(
      (asset) => asset.id === displayState?.pdfDocumentId,
    ) ?? getLecturePdfAsset(displayState?.pdfDocumentId)
  const activeAdminLecture = lectures.find(
    (item) => item.id === activeLectureSessionId,
  )
  const orderedLectures = [...lectures].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )
  const visibleLectures = showLectureHistory
    ? orderedLectures
    : orderedLectures.slice(0, 2)
  const orderedAdminPolls = [...adminPolls].sort((left, right) => {
    if (left.status === 'open' && right.status !== 'open') {
      return -1
    }
    if (left.status !== 'open' && right.status === 'open') {
      return 1
    }
    return Date.parse(right.createdAt) - Date.parse(left.createdAt)
  })
  const openAdminPolls = orderedAdminPolls.filter(
    (poll) => poll.status === 'open',
  )
  const recentAdminPolls = orderedAdminPolls.filter(
    (poll) => poll.status !== 'open',
  )
  const visibleAdminPolls = showPollHistory
    ? orderedAdminPolls
    : [...openAdminPolls, ...recentAdminPolls.slice(0, 5)]
  const canShowPollHistory =
    showPollHistory || adminPollsHasMore || recentAdminPolls.length > 5

  useEffect(() => {
    if (!isAuthenticated || !adminToken) {
      setOperatorLiveAccess(null)
      return
    }
    setOperatorLiveAccess({ kind: 'admin', token: adminToken })
    return () => setOperatorLiveAccess(null)
  }, [adminToken, isAuthenticated, setOperatorLiveAccess])

  function toDatetimeLocalValue(value: string | null) {
    if (!value) {
      return ''
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return ''
    }

    const offsetDate = new Date(
      date.getTime() - date.getTimezoneOffset() * 60000,
    )
    return offsetDate.toISOString().slice(0, 16)
  }

  function fromDatetimeLocalValue(value: string) {
    return value ? new Date(value).toISOString() : null
  }

  function makeJoinedLecture(lectureRow: AdminLecture) {
    return {
      id: lectureRow.id,
      runtimeMode: 'live' as const,
      status: lectureRow.status,
      title: lectureRow.title,
      ...(lectureRow.startsAt ? { startsAt: lectureRow.startsAt } : {}),
      ...(lectureRow.endsAt ? { endsAt: lectureRow.endsAt } : {}),
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

    try {
      const nextLectures = await supabaseAdminRepository.manageLectures({
        action: 'list',
        adminToken: token,
        includeHistory,
      })
      setLectures(nextLectures)
    } catch (error) {
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
      const result = await supabaseAdminRepository.managePolls({
        action: 'list',
        adminToken: token,
        includeHistory,
        lectureSessionId,
      })
      applyAdminPollList(result)
      return true
    } catch (error) {
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

  async function publishPdfDocument() {
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
        lectureSessionId: activeLectureSessionId,
        manifestVersion: published.manifestVersion,
        pageCount: published.document.pageCount,
        pdfSha256: published.document.pdfSha256,
        textCharCount: published.document.textCharCount,
        textSha256: published.document.textSha256,
      })
      setAdminPdfDocuments(documents)
      setPdfDocumentInput(published.document.documentId)
      setPdfFile(null)
      setPdfPublicationDraftId('')
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
    if (!isAuthenticated || !isPhase3PrivatePdfEnabled) {
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

      if (message === 'Invalid Admin session.') {
        window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
        window.sessionStorage.removeItem(ADMIN_TOKEN_SESSION_STORAGE_KEY)
        setAdminToken('')
        setIsAuthenticated(false)
        setAuthError(
          '管理者認証の有効期限が切れました。再度ログインしてください。',
        )
      }

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
        selectLectureSession(makeJoinedLecture(createdLecture))
      }
      setNewLectureTitle('Journal Club')
      setNewLectureStartsAt('')
      setNewLectureEndsAt('')
    } catch (error) {
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
          includeHistory: showPollHistory,
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
          includeHistory: showPollHistory,
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
      <main className="page-shell join-page">
        <form className="join-card" onSubmit={handleLogin}>
          <span className="admin-login-icon">
            <AppIcon name="compass" size={25} />
          </span>
          <p className="eyebrow">FOR EDUCATORS</p>
          <h1>講義を運営する</h1>
          <p>管理PINを入力して、講義コントロールを開きます。</p>

          <label className="field">
            <span>PIN</span>
            <input
              aria-label="管理PIN"
              autoComplete="off"
              disabled={isVerifying}
              inputMode="numeric"
              onChange={(event) => setPin(event.target.value)}
              type="password"
              value={pin}
            />
          </label>

          {authError ? <p className="error-note">{authError}</p> : null}

          <button
            className="primary-button"
            disabled={isVerifying || pin.trim().length === 0}
            type="submit"
          >
            {isVerifying ? '確認中…' : '講義コントロールを開く'}
          </button>
        </form>
      </main>
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
        <section className="control-card admin-session-panel">
          <div>
            <p className="eyebrow">SECURITY</p>
            <h2>管理セッション</h2>
            <p>利用していない端末のセッションを個別に失効できます。</p>
          </div>
          {adminSessionsError ? (
            <p className="error-note" role="alert">
              {adminSessionsError}
            </p>
          ) : null}
          <div className="admin-session-list">
            {adminSessions.map((session) => (
              <div className="admin-session-row" key={session.id}>
                <span>
                  <strong>
                    {session.revokedAt
                      ? '失効済み'
                      : session.id === adminCurrentSessionId
                        ? '現在のセッション'
                        : '有効なセッション'}
                  </strong>
                  <small>
                    最終確認{' '}
                    {new Date(session.lastSeenAt).toLocaleString('ja-JP')}
                  </small>
                </span>
                <button
                  className="secondary-button compact"
                  disabled={adminSessionsLoading || Boolean(session.revokedAt)}
                  onClick={() => void revokeAdminSession(session.id)}
                  type="button"
                >
                  失効する
                </button>
              </div>
            ))}
          </div>
        </section>
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

      <section className="panel" id="admin-prepare">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PREPARE</p>
            <h2>講義を準備する</h2>
          </div>
          <button
            className="secondary-button"
            disabled={lecturesLoading}
            onClick={() => void refreshLectures()}
            type="button"
          >
            再読み込み
          </button>
        </div>

        <form className="lecture-create-form" onSubmit={handleCreateLecture}>
          <label className="field compact-field">
            <span>講義タイトル</span>
            <input
              disabled={lecturesLoading}
              onChange={(event) => setNewLectureTitle(event.target.value)}
              type="text"
              value={newLectureTitle}
            />
          </label>
          <label className="field compact-field">
            <span>開始予定</span>
            <input
              disabled={lecturesLoading}
              onChange={(event) => setNewLectureStartsAt(event.target.value)}
              type="datetime-local"
              value={newLectureStartsAt}
            />
          </label>
          <label className="field compact-field">
            <span>終了予定</span>
            <input
              disabled={lecturesLoading}
              onChange={(event) => setNewLectureEndsAt(event.target.value)}
              type="datetime-local"
              value={newLectureEndsAt}
            />
          </label>
          <button
            className="primary-button compact"
            disabled={lecturesLoading || newLectureTitle.trim().length === 0}
            type="submit"
          >
            新しい講義を作成
          </button>
        </form>

        {lecturesError ? <p className="error-note">{lecturesError}</p> : null}
        {lecturesLoading ? (
          <p className="note">講義情報を更新しています。</p>
        ) : null}

        <div className="table-like lecture-table">
          {orderedLectures.length > 0 ? (
            visibleLectures.map((lectureRow) => {
              const isActive = activeLectureSessionId === lectureRow.id

              return (
                <div
                  className={`table-row lecture-admin-row ${isActive ? 'is-active' : ''}`}
                  key={lectureRow.id}
                >
                  <span>
                    <strong>{lectureRow.title}</strong>
                    <small>
                      {lectureRow.startsAt
                        ? `開始 ${toDatetimeLocalValue(lectureRow.startsAt).replace('T', ' ')}`
                        : '開始未設定'}
                      {' / '}
                      {lectureRow.endsAt
                        ? `終了 ${toDatetimeLocalValue(lectureRow.endsAt).replace('T', ' ')}`
                        : '終了未設定'}
                    </small>
                  </span>
                  <span className="lecture-code-cell">
                    <code>{lectureRow.lectureCode || '未発行'}</code>
                    <button
                      className="secondary-button compact"
                      disabled={!lectureRow.lectureCode}
                      onClick={() =>
                        void copyLectureCode(lectureRow.lectureCode)
                      }
                      type="button"
                    >
                      コピー
                    </button>
                  </span>
                  <span className={`status-pill ${lectureRow.status}`}>
                    {getStatusLabel(lectureRow.status)}
                  </span>
                  <div className="lecture-row-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        selectLectureSession(makeJoinedLecture(lectureRow))
                      }
                      type="button"
                    >
                      {isActive ? '操作対象' : '選択'}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={
                        lecturesLoading || lectureRow.status !== 'draft'
                      }
                      onClick={() =>
                        void updateLectureStatus('start', lectureRow.id)
                      }
                      type="button"
                    >
                      開始
                    </button>
                    <button
                      className="secondary-button danger-button"
                      disabled={lecturesLoading || lectureRow.status !== 'open'}
                      onClick={() =>
                        void updateLectureStatus('close', lectureRow.id)
                      }
                      type="button"
                    >
                      終了
                    </button>
                    {lectureRow.status === 'closed' ? (
                      <button
                        className="secondary-button"
                        disabled={lecturesLoading}
                        onClick={() => {
                          const confirmed = window.confirm(
                            '同じタイトルで新しい講義コードを発行し、講義を開始します。過去の記録は変更されず、資料と投票は引き継がれません。続けますか？',
                          )
                          if (confirmed) {
                            void duplicateLecture(lectureRow.id)
                          }
                        }}
                        type="button"
                      >
                        もう一度開催する
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })
          ) : (
            <p className="note">
              まだ講義がありません。最初の講義を作成しましょう。
            </p>
          )}
        </div>
        {orderedLectures.length > 2 ? (
          <button
            className="secondary-button admin-history-toggle"
            onClick={() => {
              if (showLectureHistory) {
                setShowLectureHistory(false)
                return
              }
              void refreshLectures(adminToken, true).then(() =>
                setShowLectureHistory(true),
              )
            }}
            type="button"
          >
            {showLectureHistory ? '講義履歴を閉じる' : '講義履歴を表示する'}
          </button>
        ) : null}
      </section>

      <section className="dashboard-grid">
        <article className="stat-card">
          <span>講義状態</span>
          <strong>{getStatusLabel(lecture.status)}</strong>
        </article>
        <article className="stat-card">
          <span>参加者数</span>
          <strong>約{participantCount}</strong>
        </article>
        <article className="stat-card">
          <span>表示コメント</span>
          <strong>{visibleCommentCount}</strong>
        </article>
        <article className="stat-card">
          <span>非表示コメント</span>
          <strong>{hiddenCommentCount}</strong>
        </article>
      </section>

      <section className="panel" id="admin-live">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LIVE MATERIAL</p>
            <h2>講義資料を操作する</h2>
          </div>
          <span className="metric">
            現在のページ: {displayState?.currentPdfPage ?? 1}
          </span>
        </div>

        {isPhase3PrivatePdfEnabled ? (
          <div className="display-control-grid publisher-control-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">LECTURE MATERIAL</p>
                <h3>講義資料を公開する</h3>
              </div>
              <span className="metric">
                {publisherStatus === 'paired'
                  ? '公開できます'
                  : publisherStatus === 'connected'
                    ? '初回確認が必要'
                    : publisherStatus === 'checking'
                      ? '準備を確認中'
                      : '公開アプリを確認'}
              </span>
            </div>

            {publisherStatus !== 'paired' ? (
              <details className="admin-publisher-setup">
                <summary>初回接続の設定</summary>
                <div className="display-control-form">
                  <label className="field compact-field">
                    <span>教員PCに表示された8桁コード</span>
                    <input
                      autoComplete="off"
                      disabled={pdfPublishing}
                      inputMode="numeric"
                      maxLength={8}
                      onChange={(event) =>
                        setPublisherPairingCode(
                          event.target.value.replace(/\D/g, ''),
                        )
                      }
                      value={publisherPairingCode}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={publisherStatus === 'checking' || pdfPublishing}
                    onClick={() => void checkPublisher()}
                    type="button"
                  >
                    公開準備を再確認
                  </button>
                </div>
              </details>
            ) : null}

            <div className="display-control-form">
              <label className="field compact-field">
                <span>PDFを選択（15MB・75ページ・20,000文字以下）</span>
                <input
                  accept="application/pdf,.pdf"
                  disabled={pdfPublishing || lecture.status === 'closed'}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    setPdfFile(file)
                    setPdfPublicationDraftId('')
                    if (file && !pdfDisplayName) {
                      setPdfDisplayName(file.name.replace(/\.pdf$/i, ''))
                    }
                  }}
                  type="file"
                />
              </label>
              <label className="field compact-field">
                <span>学生に表示する資料名</span>
                <input
                  disabled={pdfPublishing}
                  maxLength={160}
                  onChange={(event) => setPdfDisplayName(event.target.value)}
                  value={pdfDisplayName}
                />
              </label>
              <label className="field compact-field">
                <span>ダウンロード</span>
                <select
                  disabled={pdfPublishing}
                  onChange={(event) =>
                    setPdfDownloadEnabled(event.target.value === 'enabled')
                  }
                  value={pdfDownloadEnabled ? 'enabled' : 'disabled'}
                >
                  <option value="enabled">学生に許可する</option>
                  <option value="disabled">閲覧のみ</option>
                </select>
              </label>
              <button
                className="primary-button"
                disabled={
                  !pdfFile ||
                  pdfPublishing ||
                  lecture.status === 'closed' ||
                  (!publisherSessionToken &&
                    publisherPairingCode.trim().length !== 8)
                }
                onClick={() => void publishPdfDocument()}
                type="button"
              >
                {pdfPublishing
                  ? '学生画面へ反映中…'
                  : '学生に講義資料を公開する'}
              </button>
            </div>

            <p
              className={
                publisherMessage.includes('失敗') ? 'error-note' : 'note'
              }
            >
              {publisherMessage || 'PDFを選択して公開してください。'}
            </p>
            <p className="note">
              大きい資料は公開やAI分析に時間と費用がかかります。可能な範囲で圧縮してください。
            </p>
          </div>
        ) : null}

        {!activeLectureSessionId ? (
          <p className="note">講義へ参加後、共有画面を操作できます。</p>
        ) : (
          <div className="display-control-grid">
            <div className="display-control-form pdf-document-control">
              <label className="field compact-field">
                <span>PDF資料</span>
                <select
                  disabled={displayStateLoading || lecture.status === 'closed'}
                  onChange={(event) => setPdfDocumentInput(event.target.value)}
                  value={pdfDocumentInput}
                >
                  <option value="">資料を表示しない</option>
                  {availablePdfAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.title}（{asset.pageCount}ページ）
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={displayStateLoading || lecture.status === 'closed'}
                onClick={() =>
                  void updateDisplayState('setDocument', {
                    pdfDocumentId: pdfDocumentInput || null,
                  })
                }
                type="button"
              >
                この資料を表示
              </button>
            </div>

            <div className="display-control-actions">
              <button
                className="secondary-button"
                disabled={
                  displayStateLoading ||
                  lecture.status === 'closed' ||
                  !selectedPdfAsset ||
                  (displayState?.currentPdfPage ?? 1) <= 1
                }
                onClick={() => void updateDisplayState('previous')}
                type="button"
              >
                前へ
              </button>
              <button
                className="secondary-button"
                disabled={
                  displayStateLoading ||
                  lecture.status === 'closed' ||
                  !selectedPdfAsset ||
                  (displayState?.currentPdfPage ?? 1) >=
                    selectedPdfAsset.pageCount
                }
                onClick={() => void updateDisplayState('next')}
                type="button"
              >
                次へ
              </button>
            </div>

            <form className="display-control-form" onSubmit={handleGoToPage}>
              <label className="field compact-field">
                <span>ページ番号</span>
                <input
                  disabled={displayStateLoading || lecture.status === 'closed'}
                  max={selectedPdfAsset?.pageCount ?? 1}
                  min={1}
                  onChange={(event) => setDisplayPageInput(event.target.value)}
                  type="number"
                  value={displayPageInput}
                />
              </label>
              <button
                className="secondary-button"
                disabled={
                  displayStateLoading ||
                  lecture.status === 'closed' ||
                  !selectedPdfAsset
                }
                type="submit"
              >
                移動
              </button>
            </form>
          </div>
        )}

        {activeLectureSessionId && displayState?.pdfDocumentId ? (
          <div className="admin-current-pdf-preview">
            <h3>現在、学生に表示しているページ</h3>
            <SyncedPdfViewer
              adminToken={adminToken}
              documentId={displayState.pdfDocumentId}
              documentVersion={displayState.pdfDocumentVersion}
              lectureSessionId={activeLectureSessionId}
              manifestVersion={displayState.pdfManifestVersion}
              pageCount={displayState.pdfPageCount}
              presenterLocked
              remotePage={displayState.currentPdfPage}
              viewMode={lecture.status === 'closed' ? 'closed' : 'live'}
              visible={displayState.pdfVisible}
            />
          </div>
        ) : null}

        {displayStateError ? (
          <p className="error-note">{displayStateError}</p>
        ) : null}
        <p className="note">
          {lecture.status === 'closed'
            ? '講義終了時点で表示していた資料とページです。'
            : '学生画面と教室表示は、教員が選んだ資料とページに自動で追従します。'}
        </p>
      </section>

      <section className="panel ai-readiness-panel">
        <div className="panel-heading">
          <div className="section-intro">
            <span className="section-icon violet">
              <AppIcon name="sparkles" size={18} />
            </span>
            <div>
              <p className="eyebrow">LEARNING SUPPORT</p>
              <h2>講義の理解サポート</h2>
            </div>
          </div>
          <span
            className={`support-state ${isPhase4RealtimeCaptionsEnabled || isPhase5MaterialAnalysisEnabled || isPhase6SummariesEnabled ? 'is-ready' : ''}`}
          >
            {isPhase4RealtimeCaptionsEnabled ||
            isPhase5MaterialAnalysisEnabled ||
            isPhase6SummariesEnabled
              ? '利用可能'
              : '停止中'}
          </span>
        </div>
        <p className="panel-description">
          字幕、直近5分のハイライト、講義資料の要点が、学生の理解を途切れさせずに支えます。
        </p>
        {isPhase4RealtimeCaptionsEnabled &&
        adminToken &&
        activeLectureSessionId ? (
          <RealtimeCaptionControl
            adminToken={adminToken}
            hardStopAt={activeAdminLecture?.hardStopAt ?? lecture.expiresAt}
            lectureSessionId={activeLectureSessionId}
            lectureStatus={activeAdminLecture?.status ?? lecture.status}
          />
        ) : (
          <p className="note">
            リアルタイム字幕は現在停止しています。利用設定が完了すると、ここから開始できます。
          </p>
        )}
        {isPhase6SummariesEnabled && adminToken && activeLectureSessionId ? (
          <LectureSummaryControl
            adminToken={adminToken}
            displayState={displayState}
            documents={adminPdfDocuments}
            getServerNow={getServerNow}
            hardStopAt={activeAdminLecture?.hardStopAt ?? null}
            lectureSessionId={activeLectureSessionId}
            lectureStatus={activeAdminLecture?.status ?? lecture.status}
            publisherSessionToken={publisherSessionToken}
            startedAt={activeAdminLecture?.startsAt ?? null}
          />
        ) : (
          <p className="note">
            5分ハイライトは現在停止しています。利用時は開始にAPI利用PINが必要です。
          </p>
        )}
        {isPhase5MaterialAnalysisEnabled &&
        adminToken &&
        activeLectureSessionId ? (
          <MaterialAnalysisControl
            adminToken={adminToken}
            documents={adminPdfDocuments}
            lectureSessionId={activeLectureSessionId}
            lectureStatus={activeAdminLecture?.status ?? lecture.status}
            onPollDraftCreated={async () => {
              await refreshAdminPolls()
            }}
            publisherSessionToken={publisherSessionToken}
          />
        ) : (
          <p className="note">
            資料分析と投票案の提案は現在停止しています。PDFを公開するだけではAPI利用は発生しません。
          </p>
        )}
        <div className="api-readiness-grid">
          <article>
            <span className="support-icon">
              <AppIcon name="message" size={18} />
            </span>
            <div>
              <strong>リアルタイム字幕</strong>
              <small>
                {isPhase4RealtimeCaptionsEnabled ? '開始待ち' : '停止中'}
              </small>
            </div>
            <span
              className={`readiness-dot ${isPhase4RealtimeCaptionsEnabled ? 'is-active' : ''}`}
            />
          </article>
          <article>
            <span className="support-icon violet">
              <AppIcon name="sparkles" size={18} />
            </span>
            <div>
              <strong>5分ハイライト</strong>
              <small>
                {isPhase6SummariesEnabled ? '話の要点とみんなの反応' : '停止中'}
              </small>
            </div>
            <span
              className={`readiness-dot ${isPhase6SummariesEnabled ? 'is-active' : ''}`}
            />
          </article>
          <article>
            <span className="support-icon violet">
              <AppIcon name="book" size={18} />
            </span>
            <div>
              <strong>講義資料の要点</strong>
              <small>
                {isPhase5MaterialAnalysisEnabled
                  ? 'ページと一緒に整理して表示'
                  : '停止中'}
              </small>
            </div>
            <span
              className={`readiness-dot ${isPhase5MaterialAnalysisEnabled ? 'is-active' : ''}`}
            />
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LIVE POLL</p>
            <h2>ライブ投票をつくる</h2>
          </div>
          <button
            className="secondary-button"
            disabled={adminPollsLoading || !activeLectureSessionId}
            onClick={() => void refreshAdminPolls()}
            type="button"
          >
            再読み込み
          </button>
        </div>

        <form
          className="lecture-create-form poll-create-form"
          onSubmit={handleCreatePoll}
        >
          <label className="field">
            <span>質問</span>
            <input
              disabled={adminPollsLoading || lecture.status === 'closed'}
              maxLength={300}
              onChange={(event) => setNewPollQuestion(event.target.value)}
              type="text"
              value={newPollQuestion}
            />
          </label>
          <label className="field compact-field">
            <span>回答形式</span>
            <select
              disabled={adminPollsLoading || lecture.status === 'closed'}
              onChange={(event) =>
                setNewPollType(event.target.value as AdminPoll['type'])
              }
              value={newPollType}
            >
              <option value="single">単一選択</option>
              <option value="multiple">複数選択</option>
            </select>
          </label>
          <label className="field poll-options-field">
            <span>選択肢（1行に1件、2～8件）</span>
            <textarea
              disabled={adminPollsLoading || lecture.status === 'closed'}
              onChange={(event) => setNewPollOptions(event.target.value)}
              rows={4}
              value={newPollOptions}
            />
          </label>
          <button
            className="primary-button compact"
            disabled={
              adminPollsLoading ||
              lecture.status === 'closed' ||
              !activeLectureSessionId ||
              newPollQuestion.trim().length === 0
            }
            type="submit"
          >
            投票を作成
          </button>
        </form>

        {adminPollsError ? (
          <p className="error-note">{adminPollsError}</p>
        ) : null}
        {adminPollsLoading ? (
          <p className="note">投票情報を更新しています。</p>
        ) : null}
        <p className="note">
          新しい投票を開始すると、配信中の投票は自動で締め切られます。
        </p>

        <div className="table-like">
          {visibleAdminPolls.map((poll) => (
            <div className="table-row poll-admin-row" key={poll.id}>
              <span>
                <strong>{poll.question}</strong>
                <small>
                  {poll.options
                    .map(
                      (option) => `${option.label}: ${option.responseCount}件`,
                    )
                    .join(' / ')}
                </small>
              </span>
              <span>{poll.type === 'single' ? '単一選択' : '複数選択'}</span>
              <span className={`status-pill ${poll.status}`}>
                {getStatusLabel(poll.status)}
              </span>
              <button
                className="secondary-button"
                disabled={
                  adminPollsLoading ||
                  (poll.status !== 'open' && lecture.status !== 'open')
                }
                onClick={() => void updatePollStatus(poll)}
                type="button"
              >
                {poll.status === 'open' ? '締め切る' : '開始する'}
              </button>
            </div>
          ))}
          {!adminPollsLoading && adminPolls.length === 0 ? (
            <p className="note">
              まだ投票はありません。講義の問いを作ってみましょう。
            </p>
          ) : null}
        </div>
        {canShowPollHistory ? (
          <button
            className="secondary-button admin-history-toggle"
            onClick={() => {
              if (showPollHistory) {
                setShowPollHistory(false)
                return
              }
              void refreshAdminPolls(
                activeLectureSessionId,
                adminToken,
                true,
              ).then((loaded) => {
                if (loaded) {
                  setShowPollHistory(true)
                }
              })
            }}
            type="button"
          >
            {showPollHistory ? '投票履歴を閉じる' : '投票履歴を見る'}
          </button>
        ) : null}
      </section>

      <div id="admin-voices">
        {commentModerationError ? (
          <p className="error-note">{commentModerationError}</p>
        ) : null}
        <LiveBoard
          comments={comments}
          hasOlderComments={hasOlderComments}
          isLoadingOlderComments={isLoadingOlderComments}
          mode="admin"
          onLoadOlderComments={loadOlderComments}
          onTogglePinned={(commentId) =>
            void moderateComment(commentId, 'togglePin')
          }
          onToggleVisibility={(commentId) =>
            void moderateComment(commentId, 'toggleVisibility')
          }
        />
        {commentModerationPendingId ? (
          <p className="note">コメントを更新しています…</p>
        ) : null}
      </div>
    </main>
  )
}
