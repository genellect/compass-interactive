import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation } from 'react-router-dom'
import { demoRepository, type DemoSnapshot } from '../demo/demoRepository'
import { DEMO_LECTURE_CODE, demoLecture } from '../demo/demoSeedData'
import {
  persistLocalParticipantIdentity,
  restoreLocalParticipantId,
} from '../lib/participantIdentity'
import {
  clearJoinedLectureSession,
  JOURNAL_CLUB_MVP_CODE,
  persistJoinedLectureSession,
  restoreJoinedLectureSession,
  type JoinedLectureSession,
} from '../lib/joinedLecture'
import {
  createServerClockSample,
  estimateServerTimeMs,
  getDeadlineRefreshDelayMs,
  isLifecycleRequestCurrent,
  removePendingComments,
  type ServerClockSample,
} from '../lib/lectureLifecycle'
import { normalizeLiveSyncPathname } from '../lib/liveSync'
import {
  isPhase1SyncProtocolEnabled,
  isPhase2LectureLifecycleEnabled,
  isPhase66UxIntegrationEnabled,
  isPhase68SecurityEnabled,
} from '../lib/featureFlags'
import {
  persistLectureResumeToken,
  restoreLectureResumeTokenByCode,
} from '../lib/lectureResumeStorage'
import {
  advanceLiveStateVersions,
  getRequestedLiveStateVersions,
} from '../lib/liveSnapshot'
import {
  createOptimisticComment,
  mergeInitialCommentsWithPending,
  rollbackOptimisticComment,
  settleOptimisticComment,
} from '../lib/optimisticComments'
import { normalizeCommentNickname } from '../lib/commentNickname'
import { getLectureJoinCaptchaToken } from '../lib/turnstile'
import { ArchiveLookupError, archiveClient } from '../archive/archiveClient'
import { persistLectureArchiveResumeCode } from '../archive/archiveSessionStorage'
import { mockCompassRepository } from '../repositories'
import { supabaseCommentRepository } from '../repositories/supabaseCommentRepository'
import {
  type CommentCursor,
  type LiveStateVersions,
  type ParticipantLiveState,
  type PublicAcademicAnswer,
  type PublicCaption,
  type PublicLectureSummary,
  type PublicMaterialSummary,
  supabaseLiveStateRepository,
} from '../repositories/supabaseLiveStateRepository'
import { supabasePollRepository } from '../repositories/supabasePollRepository'
import type { PollResultSummary } from '../repositories/supabasePollRepository'
import type { DisplayState } from '../repositories/supabaseDisplayStateRepository'
import { supabaseLectureRepository } from '../repositories/supabaseLectureRepository'
import type {
  LectureSession,
  LiveComment,
  Participant,
  Poll,
  PollResponse,
} from '../types'
import { createOrUpdateParticipant } from '../services/compassActions'
import { useAdaptiveLiveSync } from '../hooks/useAdaptiveLiveSync'
import {
  CompassStateContext,
  type CompassStateValue,
  type OperatorLiveAccess,
} from './CompassStateValue'
import {
  applyCommentLikeTotals,
  applyParticipantCommentState,
  getNewestCommentCursor,
  getOldestCommentCursor,
  mergeLocalCommentLike,
  mergeLocalPollResponse,
  mergeVisibleComment,
} from './compass/commentsAndPolls'
import {
  deriveLiveSessionCapabilities,
  getInitialJoinedLectureSession,
  getSessionPauseMessage,
} from './compass/sessionLifecycle'
import { createEmptyLiveStateVersions } from './compass/snapshotState'
import { useArchiveResume } from './compass/useArchiveResume'

export function CompassStateProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const normalizedPathname = normalizeLiveSyncPathname(location.pathname)
  const [baseLecture] = useState<LectureSession>(
    mockCompassRepository.lecture.getLectureSession,
  )
  const [joinedLectureSession, setJoinedLectureSession] =
    useState<JoinedLectureSession | null>(getInitialJoinedLectureSession)
  const activeLectureSessionId = joinedLectureSession?.id ?? ''
  const runtimeMode = joinedLectureSession?.runtimeMode ?? 'live'
  const hasActiveLectureSessionId = activeLectureSessionId.length > 0
  const lecture = useMemo<LectureSession>(
    () =>
      joinedLectureSession
        ? {
            ...baseLecture,
            codeLabel:
              joinedLectureSession.runtimeMode === 'demo'
                ? DEMO_LECTURE_CODE
                : JOURNAL_CLUB_MVP_CODE,
            expectedParticipants:
              joinedLectureSession.runtimeMode === 'demo'
                ? demoLecture.expectedParticipants
                : 20,
            expiresAt: joinedLectureSession.endsAt,
            id: joinedLectureSession.id,
            startsAt: joinedLectureSession.startsAt,
            status: joinedLectureSession.status,
            title: joinedLectureSession.title,
          }
        : baseLecture,
    [baseLecture, joinedLectureSession],
  )
  const [participants, setParticipants] = useState<Participant[]>([])
  const [comments, setComments] = useState<LiveComment[]>([])
  const [polls, setPolls] = useState<Poll[]>([])
  const [pollResults, setPollResults] = useState<PollResultSummary[]>([])
  const [pollResponses, setPollResponses] = useState<PollResponse[]>([])
  const [displayState, setDisplayState] = useState<DisplayState | null>(null)
  const [caption, setCaption] = useState<PublicCaption | null>(null)
  const [summaries, setSummaries] = useState<PublicLectureSummary[]>([])
  const [academicAnswers, setAcademicAnswers] =
    useState<PublicAcademicAnswer[]>([])
  const [materialSummary, setMaterialSummary] =
    useState<PublicMaterialSummary | null>(null)
  const {
    acceptArchiveSession,
    archiveResumeError,
    archiveSession,
    clearArchiveResume,
    isArchiveResumePending,
    retryArchiveResume,
  } = useArchiveResume(normalizedPathname)
  const [participantCount, setParticipantCount] = useState(0)
  const [visibleCommentCount, setVisibleCommentCount] = useState(0)
  const [hiddenCommentCount, setHiddenCommentCount] = useState(0)
  const [operatorLiveAccess, setOperatorLiveAccessState] =
    useState<OperatorLiveAccess | null>(null)
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<
    number | null
  >(null)
  const [displayStateError, setDisplayStateError] = useState<string | null>(
    null,
  )
  const liveStateVersionsRef = useRef<LiveStateVersions>(
    createEmptyLiveStateVersions(),
  )
  const liveSnapshotInFlightRef =
    useRef<Promise<JoinedLectureSession | null> | null>(null)
  const commentCursorRef = useRef<CommentCursor | null>(null)
  const likedCommentIdsRef = useRef<Set<string>>(new Set())
  const lifecycleRequestEpochRef = useRef(0)
  const serverClockSampleRef = useRef<ServerClockSample | null>(null)
  const archiveLoadedLectureIdRef = useRef<string | null>(null)
  const [currentParticipantId, setCurrentParticipantId] = useState<
    string | null
  >(() => {
    const restoredSession = restoreJoinedLectureSession()
    if (restoredSession?.runtimeMode === 'demo') {
      return demoRepository.getSnapshot().participant.id
    }

    return activeLectureSessionId
      ? restoreLocalParticipantId(activeLectureSessionId)
      : restoreLocalParticipantId()
  })
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [commentLikesError, setCommentLikesError] = useState<string | null>(
    null,
  )
  const [pollsError, setPollsError] = useState<string | null>(null)
  const [pollResultsError, setPollResultsError] = useState<string | null>(null)
  const [pollsLoading, setPollsLoading] = useState(false)
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const [hasOlderComments, setHasOlderComments] = useState(false)
  const [isLoadingOlderComments, setIsLoadingOlderComments] = useState(false)
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now())
  const [sessionSyncPauseReason, setSessionSyncPauseReason] =
    useState<CompassStateValue['sessionSyncPauseReason']>(null)
  const isLectureOpen = joinedLectureSession?.status === 'open'
  const isSessionSyncPaused = sessionSyncPauseReason !== null
  const isLiveSyncRoute = ['/admin', '/display', '/lecture'].includes(
    normalizedPathname,
  )
  const hasRequiredOperatorAccess =
    normalizedPathname === '/admin'
      ? operatorLiveAccess?.kind === 'admin'
      : normalizedPathname === '/display'
        ? operatorLiveAccess?.kind === 'display'
        : true
  const { canInteract, canRunLiveSync } = deriveLiveSessionCapabilities({
    hasActiveLectureSessionId,
    hasRequiredOperatorAccess,
    isLectureOpen,
    isLiveSyncRoute,
    isSessionSyncPaused,
    runtimeMode,
  })

  const setOperatorLiveAccess = useCallback(
    (access: OperatorLiveAccess | null) => {
      setOperatorLiveAccessState(access)
      liveStateVersionsRef.current = createEmptyLiveStateVersions()
      liveSnapshotInFlightRef.current = null
      commentCursorRef.current = null
    },
    [],
  )

  const applyDemoSnapshot = useCallback(
    (snapshot: DemoSnapshot) => {
      clearArchiveResume()
      setJoinedLectureSession(snapshot.session)
      setCurrentParticipantId(snapshot.participant.id)
      setParticipants([snapshot.participant])
      setComments(snapshot.comments)
      setPolls(snapshot.polls)
      setPollResponses(snapshot.pollResponses)
      setPollResults(snapshot.pollResults)
      setDisplayState(snapshot.displayState)
      setCaption(null)
      setSummaries([])
      setAcademicAnswers([])
      setMaterialSummary(null)
      setParticipantCount(snapshot.lecture.expectedParticipants)
      setVisibleCommentCount(
        snapshot.comments.filter((comment) => comment.status === 'visible')
          .length,
      )
      setHiddenCommentCount(
        snapshot.comments.filter((comment) => comment.status === 'hidden')
          .length,
      )
      setLastSuccessfulSyncAt(Date.now())
      setDisplayStateError(null)
      setCommentsError(null)
      setCommentLikesError(null)
      setPollsError(null)
      setPollResultsError(null)
      setSessionSyncPauseReason(null)
    },
    [clearArchiveResume],
  )

  const hydrateDemo = useCallback(() => {
    const snapshot = demoRepository.getSnapshot()
    persistJoinedLectureSession(snapshot.session)
    applyDemoSnapshot(snapshot)
    return snapshot
  }, [applyDemoSnapshot])

  const recordSessionActivity = useCallback(() => {
    setLastActivityAt(Date.now())
  }, [])

  const applyParticipantLiveState = useCallback(
    (participantState: ParticipantLiveState) => {
      const likedCommentIds = new Set(participantState.likedCommentIds)
      likedCommentIdsRef.current = likedCommentIds
      setCurrentParticipantId(participantState.participantId)
      persistLocalParticipantIdentity(
        participantState.participantId,
        activeLectureSessionId,
      )
      setPollResponses(participantState.pollResponses)
      setComments((current) =>
        applyParticipantCommentState(
          current,
          participantState.participantId,
          likedCommentIds,
        ),
      )
    },
    [activeLectureSessionId],
  )

  const refreshParticipantLiveState = useCallback(async () => {
    if (
      !isPhase1SyncProtocolEnabled ||
      runtimeMode !== 'live' ||
      !hasActiveLectureSessionId
    ) {
      return null
    }

    const participantState =
      await supabaseLiveStateRepository.getParticipantState(
        activeLectureSessionId,
      )
    if (participantState) {
      applyParticipantLiveState(participantState)
    }
    return participantState
  }, [
    activeLectureSessionId,
    applyParticipantLiveState,
    hasActiveLectureSessionId,
    runtimeMode,
  ])

  const selectLectureSession = useCallback(
    (nextLecture: JoinedLectureSession) => {
      clearArchiveResume()
      persistJoinedLectureSession(nextLecture)
      setJoinedLectureSession(nextLecture)
      setCurrentParticipantId(
        nextLecture.runtimeMode === 'demo'
          ? demoRepository.getSnapshot().participant.id
          : restoreLocalParticipantId(nextLecture.id),
      )
      setSessionSyncPauseReason(
        nextLecture.status === 'closed' ? 'lectureClosed' : null,
      )
      lifecycleRequestEpochRef.current += 1
      archiveLoadedLectureIdRef.current = null
      setComments([])
      setPolls([])
      setPollResults([])
      setPollResponses([])
      setDisplayState(null)
      setCaption(null)
      setSummaries([])
      setAcademicAnswers([])
      setMaterialSummary(null)
      setParticipantCount(0)
      setVisibleCommentCount(0)
      setHiddenCommentCount(0)
      setLastSuccessfulSyncAt(null)
      setDisplayStateError(null)
      liveStateVersionsRef.current = createEmptyLiveStateVersions()
      commentCursorRef.current = null
      likedCommentIdsRef.current = new Set()
      serverClockSampleRef.current = null
      setHasOlderComments(false)
      setIsLoadingOlderComments(false)
      setCommentsError(null)
      setCommentLikesError(null)
      setPollsError(null)
      setPollResultsError(null)
    },
    [clearArchiveResume],
  )

  const clearLectureSessionState = useCallback(
    (clearOperatorAccess: boolean) => {
      lifecycleRequestEpochRef.current += 1
      clearJoinedLectureSession()
      clearArchiveResume()
      setJoinedLectureSession(null)
      setCurrentParticipantId(null)
      setParticipants([])
      setParticipantCount(0)
      setVisibleCommentCount(0)
      setHiddenCommentCount(0)
      if (clearOperatorAccess) {
        setOperatorLiveAccessState(null)
      }
      setComments([])
      setPolls([])
      setPollResults([])
      setPollResponses([])
      setDisplayState(null)
      setCaption(null)
      setSummaries([])
      setAcademicAnswers([])
      setMaterialSummary(null)
      setCommentsError(null)
      setCommentLikesError(null)
      setPollsError(null)
      setPollResultsError(null)
      setDisplayStateError(null)
      setSessionSyncPauseReason(null)
      setIsSubmittingComment(false)
      setHasOlderComments(false)
      setIsLoadingOlderComments(false)
      setLastSuccessfulSyncAt(null)
      liveStateVersionsRef.current = createEmptyLiveStateVersions()
      liveSnapshotInFlightRef.current = null
      commentCursorRef.current = null
      likedCommentIdsRef.current = new Set()
      serverClockSampleRef.current = null
      archiveLoadedLectureIdRef.current = null
    },
    [clearArchiveResume],
  )

  const refreshLiveSnapshot = useCallback(
    async ({
      forceAll = false,
      forceComments = false,
      forceDisplay = false,
      forceLikes = false,
      forcePolls = false,
      showLoading = false,
    }: {
      forceAll?: boolean
      forceComments?: boolean
      forceDisplay?: boolean
      forceLikes?: boolean
      forcePolls?: boolean
      showLoading?: boolean
    } = {}) => {
      if (!hasActiveLectureSessionId) {
        return null
      }

      if (runtimeMode === 'demo') {
        return hydrateDemo().session
      }

      const canShareInFlightRequest =
        !forceAll &&
        !forceComments &&
        !forceDisplay &&
        !forceLikes &&
        !forcePolls &&
        !showLoading
      if (canShareInFlightRequest && liveSnapshotInFlightRef.current) {
        return liveSnapshotInFlightRef.current
      }

      if (showLoading) {
        setCommentsLoading(true)
        setPollsLoading(true)
      }

      setCommentsError(null)
      setCommentLikesError(null)
      setPollsError(null)
      setPollResultsError(null)
      setDisplayStateError(null)

      const snapshotRequest = (async () => {
        try {
          const knownVersions = liveStateVersionsRef.current
          const activeOperatorAccess =
            operatorLiveAccess &&
            (normalizedPathname === '/admin' ||
              normalizedPathname === '/display')
              ? operatorLiveAccess
              : null
          const participantStatePromise =
            isPhase1SyncProtocolEnabled && forceAll && !activeOperatorAccess
              ? supabaseLiveStateRepository.getParticipantState(
                  activeLectureSessionId,
                )
              : Promise.resolve(null)
          const requestedVersions = getRequestedLiveStateVersions(
            knownVersions,
            {
              forceAll,
              forceComments,
              forceDisplay,
              forceLikes,
              forcePolls,
            },
          )
          const snapshot = activeOperatorAccess
            ? await supabaseLiveStateRepository.getOperatorSnapshot({
                commentCursor: commentCursorRef.current,
                lectureSessionId: activeLectureSessionId,
                protocolVersion: 2,
                versions: requestedVersions,
                ...(activeOperatorAccess.kind === 'admin'
                  ? { adminToken: activeOperatorAccess.token }
                  : { displayToken: activeOperatorAccess.token }),
              })
            : await supabaseLiveStateRepository.getSnapshot({
                commentCursor: commentCursorRef.current,
                lectureSessionId: activeLectureSessionId,
                protocolVersion: isPhase1SyncProtocolEnabled ? 2 : 1,
                versions: requestedVersions,
              })
          const participantState = await participantStatePromise

          if (snapshot.serverTime) {
            serverClockSampleRef.current = createServerClockSample(
              snapshot.serverTime,
              performance.now(),
            )
          }
          setLastSuccessfulSyncAt(Date.now())

          if (snapshot.lecture) {
            persistJoinedLectureSession(snapshot.lecture)
            setJoinedLectureSession(snapshot.lecture)
          }
          if (snapshot.currentParticipantId) {
            setCurrentParticipantId(snapshot.currentParticipantId)
          }
          if (snapshot.currentParticipantId) {
            persistLocalParticipantIdentity(
              snapshot.currentParticipantId,
              activeLectureSessionId,
            )
          }

          if (snapshot.comments || snapshot.likeTotals) {
            setComments((current) => {
              let nextComments =
                snapshot.comments?.mode === 'initial'
                  ? mergeInitialCommentsWithPending(
                      current,
                      snapshot.comments.items,
                    )
                  : (snapshot.comments?.items.reduce(
                      (merged, comment) => mergeVisibleComment(merged, comment),
                      current,
                    ) ?? current)

              if (snapshot.likeTotals) {
                nextComments = applyCommentLikeTotals(
                  nextComments,
                  snapshot.likeTotals,
                  snapshot.currentParticipantId ??
                    participantState?.participantId ??
                    null,
                  likedCommentIdsRef.current,
                )
              }

              return nextComments
            })
          }

          if (snapshot.comments) {
            if (snapshot.comments.mode === 'initial') {
              setHasOlderComments(snapshot.comments.hasOlder)
            }
            commentCursorRef.current = getNewestCommentCursor(
              snapshot.comments.items,
              snapshot.comments.mode === 'initial'
                ? null
                : commentCursorRef.current,
            )
          }

          if (snapshot.polls) {
            setPolls(snapshot.polls)
            setPollResults(snapshot.pollResults ?? [])
          }

          if (snapshot.pollResponses) {
            setPollResponses(snapshot.pollResponses)
          }

          if (snapshot.display) {
            setDisplayState(snapshot.display)
          }

          if (snapshot.caption !== undefined) {
            setCaption(snapshot.caption)
          }

          if (snapshot.summaries) {
            setSummaries(snapshot.summaries)
          }

          if (snapshot.academicAnswers) {
            setAcademicAnswers(snapshot.academicAnswers)
          }

          if (snapshot.materialSummary !== undefined) {
            setMaterialSummary(snapshot.materialSummary)
          }

          if (snapshot.metrics) {
            setParticipantCount(snapshot.metrics.participantCountApproximate)
            setVisibleCommentCount(snapshot.metrics.visibleCommentCount)
            if (
              snapshot.metrics.hiddenCommentCount !== undefined &&
              activeOperatorAccess?.kind === 'admin'
            ) {
              setHiddenCommentCount(snapshot.metrics.hiddenCommentCount)
            }
          }

          liveStateVersionsRef.current = advanceLiveStateVersions(
            knownVersions,
            snapshot,
          )

          if (participantState) {
            applyParticipantLiveState(participantState)
          }

          if (snapshot.lecture?.status === 'closed') {
            lifecycleRequestEpochRef.current += 1
            setComments(removePendingComments)
            setIsSubmittingComment(false)
            setSessionSyncPauseReason('lectureClosed')
          }

          return snapshot.lecture
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'live snapshotの取得に失敗しました。'
          if (message === 'Lecture was not found.') {
            clearLectureSessionState(false)
            return null
          }
          setCommentsError(message)
          setPollsError(message)
          setPollResultsError(message)
          setDisplayStateError(message)
          throw error
        } finally {
          if (showLoading) {
            setCommentsLoading(false)
            setPollsLoading(false)
          }
        }
      })()

      liveSnapshotInFlightRef.current = snapshotRequest
      try {
        return await snapshotRequest
      } finally {
        if (liveSnapshotInFlightRef.current === snapshotRequest) {
          liveSnapshotInFlightRef.current = null
        }
      }
    },
    [
      activeLectureSessionId,
      applyParticipantLiveState,
      clearLectureSessionState,
      hasActiveLectureSessionId,
      hydrateDemo,
      normalizedPathname,
      operatorLiveAccess,
      runtimeMode,
    ],
  )

  const refreshComments = useCallback(async () => {
    if (!hasActiveLectureSessionId) {
      setComments([])
      setCommentsError(null)
      return
    }

    if (runtimeMode === 'demo') {
      hydrateDemo()
      return
    }

    await refreshLiveSnapshot({
      forceComments: true,
      forceLikes: true,
      showLoading: true,
    })
  }, [hasActiveLectureSessionId, hydrateDemo, refreshLiveSnapshot, runtimeMode])

  const loadOlderComments = useCallback(async () => {
    if (
      !isPhase1SyncProtocolEnabled ||
      runtimeMode !== 'live' ||
      !hasActiveLectureSessionId ||
      !hasOlderComments ||
      isLoadingOlderComments
    ) {
      return
    }

    const before = getOldestCommentCursor(comments)
    if (!before) {
      setHasOlderComments(false)
      return
    }

    setIsLoadingOlderComments(true)
    setCommentsError(null)
    try {
      const page =
        operatorLiveAccess?.kind === 'admin' && normalizedPathname === '/admin'
          ? await supabaseLiveStateRepository.getOperatorCommentHistory({
              adminToken: operatorLiveAccess.token,
              before,
              lectureSessionId: activeLectureSessionId,
            })
          : await supabaseLiveStateRepository.getCommentHistory({
              before,
              lectureSessionId: activeLectureSessionId,
            })
      setComments((current) =>
        page.items.reduce((merged, comment) => {
          const nextComment =
            currentParticipantId && likedCommentIdsRef.current.has(comment.id)
              ? {
                  ...comment,
                  likedByParticipantIds: [currentParticipantId],
                }
              : comment
          if (nextComment.status === 'hidden') {
            return merged.some((item) => item.id === nextComment.id)
              ? merged
              : [...merged, nextComment].sort(
                  (left, right) =>
                    Date.parse(right.createdAt) - Date.parse(left.createdAt),
                )
          }
          return mergeVisibleComment(merged, nextComment)
        }, current),
      )
      setHasOlderComments(page.hasOlder)
    } catch (error) {
      setCommentsError(
        error instanceof Error
          ? error.message
          : '過去のコメントを取得できませんでした。',
      )
    } finally {
      setIsLoadingOlderComments(false)
    }
  }, [
    activeLectureSessionId,
    comments,
    currentParticipantId,
    hasActiveLectureSessionId,
    hasOlderComments,
    isLoadingOlderComments,
    normalizedPathname,
    operatorLiveAccess,
    runtimeMode,
  ])

  const refreshPollResults = useCallback(async () => {
    if (!hasActiveLectureSessionId) {
      setPollResults([])
      setPollResultsError(null)
      return
    }

    if (runtimeMode === 'demo') {
      hydrateDemo()
      return
    }

    await refreshLiveSnapshot({ forcePolls: true })
  }, [hasActiveLectureSessionId, hydrateDemo, refreshLiveSnapshot, runtimeMode])

  useEffect(() => {
    liveStateVersionsRef.current = createEmptyLiveStateVersions()
    commentCursorRef.current = null
    likedCommentIdsRef.current = new Set()
    archiveLoadedLectureIdRef.current = null
    setHasOlderComments(false)
    setIsLoadingOlderComments(false)

    if (
      runtimeMode !== 'live' ||
      !hasActiveLectureSessionId ||
      !hasRequiredOperatorAccess ||
      !isLectureOpen ||
      !isLiveSyncRoute
    ) {
      return
    }

    void refreshLiveSnapshot({ forceAll: true, showLoading: true })
  }, [
    activeLectureSessionId,
    hasActiveLectureSessionId,
    hasRequiredOperatorAccess,
    isLectureOpen,
    isLiveSyncRoute,
    refreshLiveSnapshot,
    runtimeMode,
  ])

  useEffect(() => {
    if (
      !isPhase2LectureLifecycleEnabled ||
      runtimeMode !== 'live' ||
      !hasActiveLectureSessionId ||
      joinedLectureSession?.status !== 'closed' ||
      !isLiveSyncRoute ||
      operatorLiveAccess !== null ||
      archiveLoadedLectureIdRef.current === activeLectureSessionId
    ) {
      return
    }

    archiveLoadedLectureIdRef.current = activeLectureSessionId
    let disposed = false

    void supabaseLiveStateRepository
      .getArchive(activeLectureSessionId)
      .then((archive) => {
        if (disposed || !archive) {
          return
        }

        persistJoinedLectureSession(archive.lecture)
        setJoinedLectureSession(archive.lecture)
        setAcademicAnswers(archive.academicAnswers)
        setComments(archive.comments)
        setDisplayState(archive.pdf)
        setSummaries(archive.summaries)
        setHasOlderComments(archive.commentsHasMore)
      })
      .catch((error) => {
        if (!disposed) {
          setCommentsError(
            error instanceof Error
              ? error.message
              : '講義アーカイブを取得できませんでした。',
          )
        }
      })

    return () => {
      disposed = true
    }
  }, [
    activeLectureSessionId,
    hasActiveLectureSessionId,
    isLiveSyncRoute,
    joinedLectureSession?.status,
    operatorLiveAccess,
    runtimeMode,
  ])

  const resumeSessionSync = useCallback(async () => {
    if (
      !hasActiveLectureSessionId ||
      sessionSyncPauseReason === 'lectureClosed'
    ) {
      return
    }

    if (runtimeMode === 'demo') {
      hydrateDemo()
      return
    }

    recordSessionActivity()
    const latestLecture = await refreshLiveSnapshot({
      forceAll: true,
      showLoading: true,
    })

    if (!latestLecture || latestLecture.status !== 'open') {
      setSessionSyncPauseReason('lectureClosed')
      return
    }

    setSessionSyncPauseReason(null)
  }, [
    hasActiveLectureSessionId,
    recordSessionActivity,
    refreshLiveSnapshot,
    hydrateDemo,
    runtimeMode,
    sessionSyncPauseReason,
  ])

  const runFiveSecondLiveSync = useCallback(async () => {
    if (!canRunLiveSync) {
      return
    }

    await refreshLiveSnapshot()
  }, [canRunLiveSync, refreshLiveSnapshot])

  useAdaptiveLiveSync({
    enabled: canRunLiveSync,
    onSync: runFiveSecondLiveSync,
    runImmediately: false,
  })

  useEffect(() => {
    if (
      !isPhase2LectureLifecycleEnabled ||
      runtimeMode !== 'live' ||
      !canRunLiveSync ||
      !joinedLectureSession?.hardStopAt
    ) {
      return
    }

    const sample = serverClockSampleRef.current
    if (!sample) {
      return
    }
    const delay = getDeadlineRefreshDelayMs({
      hardStopAt: joinedLectureSession.hardStopAt,
      monotonicNowMs: performance.now(),
      sample,
    })
    if (delay === null) {
      return
    }
    const timeoutId = window.setTimeout(
      () => {
        void refreshLiveSnapshot({ forceAll: true }).catch(() => undefined)
      },
      Math.min(delay + 25, 2_147_483_647),
    )

    return () => window.clearTimeout(timeoutId)
  }, [
    canRunLiveSync,
    joinedLectureSession?.hardStopAt,
    refreshLiveSnapshot,
    runtimeMode,
  ])

  useEffect(() => {
    if (runtimeMode !== 'demo' || !hasActiveLectureSessionId) {
      return
    }

    hydrateDemo()
  }, [hasActiveLectureSessionId, hydrateDemo, runtimeMode])

  useEffect(() => {
    if (runtimeMode !== 'demo') {
      return
    }

    return demoRepository.subscribe(hydrateDemo)
  }, [hydrateDemo, runtimeMode])

  useEffect(() => {
    if (runtimeMode !== 'demo' || !hasActiveLectureSessionId) return
    const interval = window.setInterval(() => {
      applyDemoSnapshot(demoRepository.addNextAmbientComment())
    }, 10_000)
    return () => window.clearInterval(interval)
  }, [applyDemoSnapshot, hasActiveLectureSessionId, runtimeMode])

  const visibleComments =
    mockCompassRepository.comment.listVisibleComments(comments)
  const openPolls = mockCompassRepository.poll.listOpenPolls(polls)
  const resetDemoLecture = useCallback(() => {
    if (runtimeMode !== 'demo') {
      return
    }

    const snapshot = demoRepository.reset()
    persistJoinedLectureSession(snapshot.session)
    applyDemoSnapshot(snapshot)
  }, [applyDemoSnapshot, runtimeMode])

  const leaveLecture = useCallback(() => {
    clearLectureSessionState(true)
  }, [clearLectureSessionState])

  const getServerNow = useCallback(() => {
    const sample = serverClockSampleRef.current
    if (!sample) return runtimeMode === 'demo' ? new Date().toISOString() : null
    return new Date(
      estimateServerTimeMs(sample, performance.now()),
    ).toISOString()
  }, [runtimeMode])

  const value = useMemo<CompassStateValue>(
    () => ({
      archiveSession,
      academicAnswers,
      caption,
      summaries,
      materialSummary,
      lecture,
      participants,
      participantCount:
        runtimeMode === 'demo'
          ? lecture.expectedParticipants
          : participantCount,
      visibleCommentCount:
        runtimeMode === 'demo' ? visibleComments.length : visibleCommentCount,
      comments,
      visibleComments,
      hiddenCommentCount,
      polls,
      openPolls,
      pollResponses,
      pollResults,
      currentParticipantId,
      activeLectureSessionId: activeLectureSessionId || null,
      hasJoinedLectureSession: Boolean(joinedLectureSession),
      runtimeMode,
      expectedLectureCode:
        runtimeMode === 'demo' ? DEMO_LECTURE_CODE : JOURNAL_CLUB_MVP_CODE,
      commentsLoading,
      hasOlderComments,
      isLoadingOlderComments,
      isArchiveResumePending,
      archiveResumeError,
      commentsError,
      commentLikesError,
      pollsError,
      pollResultsError,
      pollsLoading,
      displayState,
      displayStateError,
      isSubmittingComment,
      isSessionSyncPaused,
      lastActivityAt,
      lastSuccessfulSyncAt,
      getServerNow,
      leaveLecture,
      setOperatorLiveAccess,
      resumeSessionSync,
      resetDemoLecture,
      retryArchiveResume,
      selectLectureSession,
      sessionSyncMessage: getSessionPauseMessage(sessionSyncPauseReason),
      sessionSyncPauseReason,
      refreshComments,
      loadOlderComments,
      refreshPollResults,
      joinLecture: async (lectureCode) => {
        try {
          if (lectureCode.trim().toUpperCase() === DEMO_LECTURE_CODE) {
            const snapshot = demoRepository.getSnapshot()
            persistJoinedLectureSession(snapshot.session)
            applyDemoSnapshot(snapshot)
            recordSessionActivity()
            return {
              destination: 'lecture',
              ok: true,
              participantId: snapshot.participant.id,
            }
          }

          if (isPhase66UxIntegrationEnabled && archiveClient.isConfigured()) {
            const storedResume = isPhase68SecurityEnabled
              ? restoreLectureResumeTokenByCode(lectureCode)
              : null
            const resumedArchive = storedResume
              ? await archiveClient
                  .resumeLecture(storedResume.token, lectureCode)
                  .catch(() => null)
              : null
            const archive =
              resumedArchive ??
              (await getLectureJoinCaptchaToken().then((archiveCaptchaToken) =>
                archiveClient
                  .resolveLectureCode(lectureCode, archiveCaptchaToken)
                  .catch((error) => {
                    if (
                      error instanceof ArchiveLookupError &&
                      error.status < 500
                    ) {
                      throw error
                    }
                    return null
                  }),
              ))
            if (archive) {
              lifecycleRequestEpochRef.current += 1
              clearJoinedLectureSession()
              persistLectureArchiveResumeCode(lectureCode)
              setJoinedLectureSession(null)
              acceptArchiveSession(archive)
              setCurrentParticipantId(null)
              setParticipants([])
              setParticipantCount(archive.participantCountApproximate)
              setVisibleCommentCount(archive.comments.length)
              setComments([])
              setPolls([])
              setPollResults([])
              setPollResponses([])
              setDisplayState(null)
              setCaption(null)
              setSummaries([])
              setAcademicAnswers([])
              setMaterialSummary(null)
              setSessionSyncPauseReason(null)
              setLastSuccessfulSyncAt(null)
              recordSessionActivity()
              return {
                destination: 'archive',
                ok: true,
                participantId: null,
              }
            }
          }

          const {
            lecture: joinedLecture,
            participantId,
            resumeToken,
            resumeTokenExpiresAt,
          } = await supabaseLectureRepository.joinLectureByCode(
            lectureCode,
            undefined,
          )

          clearArchiveResume()
          persistJoinedLectureSession(joinedLecture)
          persistLocalParticipantIdentity(participantId, joinedLecture.id)
          if (resumeToken && resumeTokenExpiresAt) {
            persistLectureResumeToken({
              expiresAt: resumeTokenExpiresAt,
              lectureCode: lectureCode.trim().toUpperCase(),
              lectureSessionId: joinedLecture.id,
              token: resumeToken,
            })
          }
          setSessionSyncPauseReason(null)
          recordSessionActivity()

          const joinedLectureForParticipant: LectureSession = {
            ...baseLecture,
            codeLabel: JOURNAL_CLUB_MVP_CODE,
            expectedParticipants: 20,
            expiresAt: joinedLecture.endsAt,
            id: joinedLecture.id,
            startsAt: joinedLecture.startsAt,
            status: joinedLecture.status,
            title: joinedLecture.title,
          }

          setJoinedLectureSession(joinedLecture)
          setCurrentParticipantId(participantId)
          setParticipants(
            (current) =>
              createOrUpdateParticipant({
                lecture: joinedLectureForParticipant,
                participantId,
                participants: current,
              }).participants,
          )
          setParticipantCount((current) => Math.max(current, 1))
          setCommentsError(null)
          setPollsError(null)
          setCommentLikesError(null)
          setPollResultsError(null)
          return {
            destination: 'lecture',
            ok: true,
            participantId,
          }
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : '講義コードの確認に失敗しました。',
          }
        }
      },
      addComment: async (body, nickname) => {
        if (!currentParticipantId) {
          setCommentsError('講義に参加してからコメントしてください。')
          return false
        }

        if (!hasActiveLectureSessionId) {
          setCommentsError('講義コードで参加してからコメントしてください。')
          return false
        }

        if (!canInteract) {
          setCommentsError(
            getSessionPauseMessage(sessionSyncPauseReason) ??
              '同期停止中のため、コメントできません。',
          )
          return false
        }

        const trimmedBody = body.trim().slice(0, 120)
        const normalizedNickname = normalizeCommentNickname(nickname)
        if (!trimmedBody) {
          setCommentsError('コメントを入力してください。')
          return false
        }

        setIsSubmittingComment(true)
        setCommentsError(null)
        recordSessionActivity()
        const requestEpoch = lifecycleRequestEpochRef.current

        let optimisticCommentId: string | null = null
        try {
          if (runtimeMode === 'demo') {
            applyDemoSnapshot(
              demoRepository.addComment(trimmedBody, normalizedNickname),
            )
            return true
          }

          const optimisticComment = createOptimisticComment({
            body: trimmedBody,
            lectureId: activeLectureSessionId,
            nickname: normalizedNickname,
            participantId: currentParticipantId,
          })
          optimisticCommentId = optimisticComment.id
          setComments((current) =>
            mergeVisibleComment(current, optimisticComment),
          )

          const createdComment =
            await supabaseCommentRepository.createVisibleComment({
              body: trimmedBody,
              lectureSessionId: activeLectureSessionId,
              nickname: normalizedNickname,
              participantId: currentParticipantId,
            })
          if (
            !isLifecycleRequestCurrent(
              requestEpoch,
              lifecycleRequestEpochRef.current,
            )
          ) {
            return false
          }
          setComments((current) =>
            settleOptimisticComment(
              current,
              optimisticComment.id,
              createdComment,
            ),
          )
          void refreshParticipantLiveState().catch(() => undefined)
          return true
        } catch (error) {
          if (optimisticCommentId) {
            const rejectedCommentId = optimisticCommentId
            setComments((current) =>
              rollbackOptimisticComment(current, rejectedCommentId),
            )
          }
          if (
            isLifecycleRequestCurrent(
              requestEpoch,
              lifecycleRequestEpochRef.current,
            )
          ) {
            setCommentsError(
              error instanceof Error
                ? error.message
                : 'コメント投稿に失敗しました。',
            )
          }
          return false
        } finally {
          setIsSubmittingComment(false)
        }
      },
      toggleCommentLike: async (commentId) => {
        if (!currentParticipantId) {
          setCommentLikesError('講義に参加してからいいねしてください。')
          return
        }

        if (!hasActiveLectureSessionId) {
          setCommentLikesError('講義コードで参加してからいいねしてください。')
          return
        }

        if (!canInteract) {
          setCommentLikesError(
            getSessionPauseMessage(sessionSyncPauseReason) ??
              '同期停止中のため、いいねできません。',
          )
          return
        }

        const targetComment = comments.find(
          (comment) => comment.id === commentId,
        )

        if (!targetComment || targetComment.status !== 'visible') {
          return
        }

        if (
          targetComment.likedByParticipantIds.includes(currentParticipantId)
        ) {
          setCommentLikesError('共感は取り消せません。')
          return
        }

        setCommentLikesError(null)
        recordSessionActivity()
        const requestEpoch = lifecycleRequestEpochRef.current

        try {
          if (runtimeMode === 'demo') {
            applyDemoSnapshot(demoRepository.addCommentLike(commentId))
            return
          }

          await supabaseCommentRepository.addCommentLike({
            commentId,
            lectureSessionId: activeLectureSessionId,
            participantId: currentParticipantId,
          })
          if (
            !isLifecycleRequestCurrent(
              requestEpoch,
              lifecycleRequestEpochRef.current,
            )
          ) {
            return
          }
          likedCommentIdsRef.current.add(commentId)
          setComments((current) =>
            mergeLocalCommentLike(current, commentId, currentParticipantId),
          )
          void refreshParticipantLiveState().catch(() => undefined)
        } catch (error) {
          if (
            isLifecycleRequestCurrent(
              requestEpoch,
              lifecycleRequestEpochRef.current,
            )
          ) {
            setCommentLikesError(
              error instanceof Error
                ? `いいねに失敗しました: ${error.message}`
                : 'いいねに失敗しました。',
            )
          }
        }
      },
      toggleCommentVisibility: (commentId) => {
        setComments((current) =>
          mockCompassRepository.comment.toggleVisibility({
            commentId,
            comments: current,
          }),
        )
      },
      toggleCommentPinned: (commentId) => {
        setComments((current) =>
          mockCompassRepository.comment.togglePinned({
            commentId,
            comments: current,
          }),
        )
      },
      submitPollResponse: async (pollId, optionIds) => {
        if (!currentParticipantId) {
          return
        }

        if (!canInteract) {
          setPollsError(
            getSessionPauseMessage(sessionSyncPauseReason) ??
              '同期停止中のため、Pollに回答できません。',
          )
          return
        }

        const poll = polls.find((item) => item.id === pollId)
        if (!poll || poll.status !== 'open' || optionIds.length === 0) {
          return
        }

        const normalizedOptionIds =
          poll.type === 'single' ? optionIds.slice(0, 1) : optionIds

        const alreadyAnswered = pollResponses.some(
          (response) =>
            response.pollId === pollId &&
            response.participantId === currentParticipantId,
        )

        if (alreadyAnswered) {
          setPollsError('この投票には回答済みです。再回答はできません。')
          return
        }

        if (runtimeMode === 'demo') {
          setPollsError(null)
          recordSessionActivity()
          applyDemoSnapshot(
            demoRepository.submitPollResponse(pollId, normalizedOptionIds),
          )
          return
        }

        setPollsError(null)
        recordSessionActivity()
        const requestEpoch = lifecycleRequestEpochRef.current

        try {
          await supabasePollRepository.submitPollResponse({
            lectureSessionId: activeLectureSessionId,
            optionIds: normalizedOptionIds,
            participantId: currentParticipantId,
            pollId,
          })
          if (
            !isLifecycleRequestCurrent(
              requestEpoch,
              lifecycleRequestEpochRef.current,
            )
          ) {
            return
          }
          setPollResponses((current) =>
            mergeLocalPollResponse({
              currentResponses: current,
              optionIds: normalizedOptionIds,
              participantId: currentParticipantId,
              pollId,
            }),
          )
          void refreshParticipantLiveState().catch(() => undefined)
        } catch (error) {
          if (
            isLifecycleRequestCurrent(
              requestEpoch,
              lifecycleRequestEpochRef.current,
            )
          ) {
            setPollsError(
              error instanceof Error
                ? `投票に失敗しました: ${error.message}`
                : '投票に失敗しました。',
            )
          }
        }
      },
    }),
    [
      acceptArchiveSession,
      archiveSession,
      academicAnswers,
      caption,
      summaries,
      materialSummary,
      comments,
      activeLectureSessionId,
      baseLecture,
      commentsError,
      commentsLoading,
      hasOlderComments,
      commentLikesError,
      canInteract,
      clearArchiveResume,
      currentParticipantId,
      hasActiveLectureSessionId,
      hiddenCommentCount,
      isSubmittingComment,
      isLoadingOlderComments,
      isArchiveResumePending,
      archiveResumeError,
      joinedLectureSession,
      lecture,
      openPolls,
      participants,
      participantCount,
      pollResponses,
      pollResults,
      pollsError,
      pollResultsError,
      pollsLoading,
      displayState,
      displayStateError,
      polls,
      isSessionSyncPaused,
      lastActivityAt,
      lastSuccessfulSyncAt,
      getServerNow,
      leaveLecture,
      setOperatorLiveAccess,
      recordSessionActivity,
      resetDemoLecture,
      retryArchiveResume,
      resumeSessionSync,
      selectLectureSession,
      sessionSyncPauseReason,
      refreshComments,
      loadOlderComments,
      refreshParticipantLiveState,
      refreshPollResults,
      visibleComments,
      visibleCommentCount,
      runtimeMode,
      applyDemoSnapshot,
    ],
  )

  return (
    <CompassStateContext.Provider value={value}>
      {children}
    </CompassStateContext.Provider>
  )
}
