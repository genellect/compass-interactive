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
} from '../lib/featureFlags'
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
import { mockCompassRepository } from '../repositories'
import { supabaseCommentRepository } from '../repositories/supabaseCommentRepository'
import {
  type CommentCursor,
  type CommentLikeTotal,
  type LiveStateVersions,
  type ParticipantLiveState,
  type PublicCaption,
  type PublicLectureSummary,
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
} from './CompassStateValue'

function createEmptyLiveStateVersions(): LiveStateVersions {
  return {
    caption: null,
    comments: null,
    display: null,
    lecture: null,
    likes: null,
    pdf: null,
    polls: null,
    state: null,
    summaries: null,
  }
}

function mergeLocalPollResponse({
  currentResponses,
  optionIds,
  participantId,
  pollId,
}: {
  currentResponses: PollResponse[]
  optionIds: string[]
  participantId: string
  pollId: string
}) {
  const nextResponse: PollResponse = {
    id: `local-response-${pollId}-${participantId}`,
    pollId,
    participantId,
    optionIds,
    createdAt: new Date().toISOString(),
  }

  return [
    ...currentResponses.filter(
      (response) =>
        !(
          response.pollId === pollId && response.participantId === participantId
        ),
    ),
    nextResponse,
  ]
}

function mergeVisibleComment(
  currentComments: LiveComment[],
  nextComment: LiveComment,
) {
  if (nextComment.status !== 'visible') {
    return currentComments
  }

  if (currentComments.some((comment) => comment.id === nextComment.id)) {
    return currentComments
  }

  return [nextComment, ...currentComments].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

function applyCommentLikeTotals(
  currentComments: LiveComment[],
  totals: CommentLikeTotal[],
  participantId: string | null,
  likedCommentIds: ReadonlySet<string>,
) {
  const totalsByComment = new Map(
    totals.map((total) => [total.commentId, total] as const),
  )

  return currentComments.map((comment) => {
    const total = totalsByComment.get(comment.id)

    return {
      ...comment,
      likeCount: total?.likeCount ?? 0,
      likedByParticipantIds:
        participantId &&
        (likedCommentIds.has(comment.id) || total?.likedByParticipant)
          ? [participantId]
          : [],
    }
  })
}

function applyParticipantCommentState(
  currentComments: LiveComment[],
  participantId: string,
  likedCommentIds: ReadonlySet<string>,
) {
  return currentComments.map((comment) => ({
    ...comment,
    likedByParticipantIds: likedCommentIds.has(comment.id)
      ? [participantId]
      : [],
  }))
}

function getNewestCommentCursor(
  comments: LiveComment[],
  currentCursor: CommentCursor | null,
) {
  return comments.reduce<CommentCursor | null>((latest, comment) => {
    const candidate = { createdAt: comment.createdAt, id: comment.id }
    if (!latest) {
      return candidate
    }

    const createdAtComparison = candidate.createdAt.localeCompare(
      latest.createdAt,
    )
    return createdAtComparison > 0 ||
      (createdAtComparison === 0 && candidate.id.localeCompare(latest.id) > 0)
      ? candidate
      : latest
  }, currentCursor)
}

function getOldestCommentCursor(comments: LiveComment[]) {
  return comments.reduce<CommentCursor | null>((oldest, comment) => {
    if (comment.isPending) {
      return oldest
    }

    const candidate = { createdAt: comment.createdAt, id: comment.id }
    if (!oldest) {
      return candidate
    }

    const createdAtComparison = candidate.createdAt.localeCompare(
      oldest.createdAt,
    )
    return createdAtComparison < 0 ||
      (createdAtComparison === 0 && candidate.id.localeCompare(oldest.id) < 0)
      ? candidate
      : oldest
  }, null)
}

function mergeLocalCommentLike(
  currentComments: LiveComment[],
  commentId: string,
  participantId: string,
) {
  return currentComments.map((comment) => {
    if (comment.id !== commentId) {
      return comment
    }

    if (comment.status !== 'visible') {
      return comment
    }

    if (comment.likedByParticipantIds.includes(participantId)) {
      return comment
    }

    return {
      ...comment,
      likedByParticipantIds: [...comment.likedByParticipantIds, participantId],
      likeCount: comment.likeCount + 1,
    }
  })
}

function getInitialJoinedLectureSession(): JoinedLectureSession | null {
  return restoreJoinedLectureSession()
}

function getSessionPauseMessage(
  reason: CompassStateValue['sessionSyncPauseReason'],
) {
  if (reason === 'lectureClosed') {
    return '講義は終了しました。コメント投稿、いいね、Poll回答は停止しています。'
  }

  if (reason === 'idle') {
    return '一定時間操作がなかったため、同期を停止しました。'
  }

  if (reason === 'hidden') {
    return '長時間バックグラウンドだったため、同期を停止しました。'
  }

  return null
}

export function CompassStateProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
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
  const normalizedPathname = normalizeLiveSyncPathname(location.pathname)
  const isLiveSyncRoute = ['/admin', '/display', '/lecture'].includes(
    normalizedPathname,
  )
  const canRunLiveSync =
    runtimeMode === 'live' &&
    hasActiveLectureSessionId &&
    isLectureOpen &&
    isLiveSyncRoute &&
    !isSessionSyncPaused
  const canInteract =
    runtimeMode === 'demo'
      ? hasActiveLectureSessionId && isLectureOpen
      : canRunLiveSync

  const applyDemoSnapshot = useCallback((snapshot: DemoSnapshot) => {
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
    setDisplayStateError(null)
    setCommentsError(null)
    setCommentLikesError(null)
    setPollsError(null)
    setPollResultsError(null)
    setSessionSyncPauseReason(null)
  }, [])

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
    [],
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
          const participantStatePromise =
            isPhase1SyncProtocolEnabled && forceAll
              ? supabaseLiveStateRepository.getParticipantState(
                  activeLectureSessionId,
                )
              : Promise.resolve(null)
          const snapshot = await supabaseLiveStateRepository.getSnapshot({
            commentCursor: commentCursorRef.current,
            lectureSessionId: activeLectureSessionId,
            protocolVersion: isPhase1SyncProtocolEnabled ? 2 : 1,
            versions: getRequestedLiveStateVersions(knownVersions, {
              forceAll,
              forceComments,
              forceDisplay,
              forceLikes,
              forcePolls,
            }),
          })
          const participantState = await participantStatePromise

          if (snapshot.serverTime) {
            serverClockSampleRef.current = createServerClockSample(
              snapshot.serverTime,
              performance.now(),
            )
          }

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
      hasActiveLectureSessionId,
      hydrateDemo,
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
      const page = await supabaseLiveStateRepository.getCommentHistory({
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
      !isLectureOpen ||
      !isLiveSyncRoute
    ) {
      return
    }

    void refreshLiveSnapshot({ forceAll: true, showLoading: true })
  }, [
    activeLectureSessionId,
    hasActiveLectureSessionId,
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

  const visibleComments =
    mockCompassRepository.comment.listVisibleComments(comments)
  const openPolls = mockCompassRepository.poll.listOpenPolls(polls)
  const hiddenCommentCount = comments.length - visibleComments.length
  const resetDemoLecture = useCallback(() => {
    if (runtimeMode !== 'demo') {
      return
    }

    const snapshot = demoRepository.reset()
    persistJoinedLectureSession(snapshot.session)
    applyDemoSnapshot(snapshot)
  }, [applyDemoSnapshot, runtimeMode])

  const getServerNow = useCallback(() => {
    const sample = serverClockSampleRef.current
    if (!sample) return runtimeMode === 'demo' ? new Date().toISOString() : null
    return new Date(
      estimateServerTimeMs(sample, performance.now()),
    ).toISOString()
  }, [runtimeMode])

  const value = useMemo<CompassStateValue>(
    () => ({
      caption,
      summaries,
      lecture,
      participants,
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
      getServerNow,
      resumeSessionSync,
      resetDemoLecture,
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
            return { ok: true, participantId: snapshot.participant.id }
          }

          const { lecture: joinedLecture, participantId } =
            await supabaseLectureRepository.joinLectureByCode(lectureCode)

          persistJoinedLectureSession(joinedLecture)
          persistLocalParticipantIdentity(participantId, joinedLecture.id)
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
          setCommentsError(null)
          setPollsError(null)
          setCommentLikesError(null)
          setPollResultsError(null)
          return { ok: true, participantId }
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
          setCommentLikesError('いいね取消はPhase 2-Fでは未実装です。')
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
          setPollsError(
            'このPollは回答済みです。再回答はPhase 2-Hでは未実装です。',
          )
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
                ? `Poll回答に失敗しました: ${error.message}`
                : 'Poll回答に失敗しました。',
            )
          }
        }
      },
    }),
    [
      caption,
      summaries,
      comments,
      activeLectureSessionId,
      baseLecture,
      commentsError,
      commentsLoading,
      hasOlderComments,
      commentLikesError,
      canInteract,
      currentParticipantId,
      hasActiveLectureSessionId,
      hiddenCommentCount,
      isSubmittingComment,
      isLoadingOlderComments,
      joinedLectureSession,
      lecture,
      openPolls,
      participants,
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
      getServerNow,
      recordSessionActivity,
      resetDemoLecture,
      resumeSessionSync,
      selectLectureSession,
      sessionSyncPauseReason,
      refreshComments,
      loadOlderComments,
      refreshParticipantLiveState,
      refreshPollResults,
      visibleComments,
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
