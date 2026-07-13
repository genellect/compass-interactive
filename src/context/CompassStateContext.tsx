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
  HIDDEN_SYNC_STOP_MS,
  IDLE_SYNC_TIMEOUT_MS,
  normalizeLiveSyncPathname,
} from '../lib/liveSync'
import {
  advanceLiveStateVersions,
  getRequestedLiveStateVersions,
} from '../lib/liveSnapshot'
import { mockCompassRepository } from '../repositories'
import { supabaseCommentRepository } from '../repositories/supabaseCommentRepository'
import {
  type CommentCursor,
  type CommentLikeTotal,
  type LiveStateVersions,
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
    comments: null,
    display: null,
    likes: null,
    polls: null,
    state: null,
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
        total?.likedByParticipant && participantId ? [participantId] : [],
    }
  })
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
  const [displayStateError, setDisplayStateError] = useState<string | null>(
    null,
  )
  const liveStateVersionsRef = useRef<LiveStateVersions>(
    createEmptyLiveStateVersions(),
  )
  const liveSnapshotInFlightRef =
    useRef<Promise<JoinedLectureSession | null> | null>(null)
  const commentCursorRef = useRef<CommentCursor | null>(null)
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
  const isLectureRoute = normalizedPathname === '/lecture'

  const applyDemoSnapshot = useCallback((snapshot: DemoSnapshot) => {
    setJoinedLectureSession(snapshot.session)
    setCurrentParticipantId(snapshot.participant.id)
    setParticipants([snapshot.participant])
    setComments(snapshot.comments)
    setPolls(snapshot.polls)
    setPollResponses(snapshot.pollResponses)
    setPollResults(snapshot.pollResults)
    setDisplayState(snapshot.displayState)
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
      setComments([])
      setPolls([])
      setPollResults([])
      setPollResponses([])
      setDisplayState(null)
      setDisplayStateError(null)
      liveStateVersionsRef.current = createEmptyLiveStateVersions()
      commentCursorRef.current = null
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
          const snapshot = await supabaseLiveStateRepository.getSnapshot({
            commentCursor: commentCursorRef.current,
            lectureSessionId: activeLectureSessionId,
            versions: getRequestedLiveStateVersions(knownVersions, {
              forceAll,
              forceComments,
              forceDisplay,
              forceLikes,
              forcePolls,
            }),
          })

          persistJoinedLectureSession(snapshot.lecture)
          setJoinedLectureSession(snapshot.lecture)
          setCurrentParticipantId(snapshot.currentParticipantId)
          if (snapshot.currentParticipantId) {
            persistLocalParticipantIdentity(
              snapshot.currentParticipantId,
              snapshot.lecture.id,
            )
          }

          if (snapshot.comments || snapshot.likeTotals) {
            setComments((current) => {
              let nextComments =
                snapshot.comments?.mode === 'initial'
                  ? snapshot.comments.items
                  : (snapshot.comments?.items.reduce(
                      (merged, comment) => mergeVisibleComment(merged, comment),
                      current,
                    ) ?? current)

              if (snapshot.likeTotals) {
                nextComments = applyCommentLikeTotals(
                  nextComments,
                  snapshot.likeTotals,
                  snapshot.currentParticipantId,
                )
              }

              return nextComments
            })
          }

          if (snapshot.comments) {
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
            setPollResponses(snapshot.pollResponses ?? [])
          }

          if (snapshot.display) {
            setDisplayState(snapshot.display)
          }

          liveStateVersionsRef.current = advanceLiveStateVersions(
            knownVersions,
            snapshot,
          )

          if (snapshot.lecture.status === 'closed') {
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
      runtimeMode !== 'live' ||
      !hasActiveLectureSessionId ||
      !isLectureOpen ||
      !isLectureRoute
    ) {
      return
    }

    const events = ['keydown', 'pointerdown', 'touchstart'] as const
    for (const eventName of events) {
      window.addEventListener(eventName, recordSessionActivity, {
        passive: true,
      })
    }

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, recordSessionActivity)
      }
    }
  }, [
    hasActiveLectureSessionId,
    isLectureOpen,
    isLectureRoute,
    recordSessionActivity,
    runtimeMode,
  ])

  useEffect(() => {
    if (
      !hasActiveLectureSessionId ||
      !isLectureOpen ||
      !isLectureRoute ||
      runtimeMode !== 'live' ||
      isSessionSyncPaused
    ) {
      return
    }

    const elapsedMs = Date.now() - lastActivityAt
    const remainingMs = IDLE_SYNC_TIMEOUT_MS - elapsedMs

    if (remainingMs <= 0) {
      setSessionSyncPauseReason('idle')
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSessionSyncPauseReason('idle')
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [
    hasActiveLectureSessionId,
    isLectureOpen,
    isLectureRoute,
    isSessionSyncPaused,
    lastActivityAt,
    runtimeMode,
  ])

  useEffect(() => {
    if (
      runtimeMode !== 'live' ||
      !hasActiveLectureSessionId ||
      !isLectureOpen ||
      isSessionSyncPaused
    ) {
      return
    }

    let timeoutId: number | null = null

    function clearHiddenTimeout() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    function handleVisibilityChange() {
      clearHiddenTimeout()

      if (document.visibilityState === 'hidden') {
        timeoutId = window.setTimeout(() => {
          setSessionSyncPauseReason('hidden')
        }, HIDDEN_SYNC_STOP_MS)
      } else {
        recordSessionActivity()
      }
    }

    handleVisibilityChange()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearHiddenTimeout()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    hasActiveLectureSessionId,
    isLectureOpen,
    isSessionSyncPaused,
    recordSessionActivity,
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

  const value = useMemo<CompassStateValue>(
    () => ({
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
      resumeSessionSync,
      resetDemoLecture,
      selectLectureSession,
      sessionSyncMessage: getSessionPauseMessage(sessionSyncPauseReason),
      sessionSyncPauseReason,
      refreshComments,
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
      addComment: async (body) => {
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

        setIsSubmittingComment(true)
        setCommentsError(null)
        recordSessionActivity()

        try {
          if (runtimeMode === 'demo') {
            applyDemoSnapshot(demoRepository.addComment(body))
            return true
          }

          const createdComment =
            await supabaseCommentRepository.createVisibleComment({
              body,
              lectureSessionId: activeLectureSessionId,
              participantId: currentParticipantId,
            })
          setComments((current) => mergeVisibleComment(current, createdComment))
          return true
        } catch (error) {
          setCommentsError(
            error instanceof Error
              ? error.message
              : 'コメント投稿に失敗しました。',
          )
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
          setComments((current) =>
            mergeLocalCommentLike(current, commentId, currentParticipantId),
          )
        } catch (error) {
          setCommentLikesError(
            error instanceof Error
              ? `いいねに失敗しました: ${error.message}`
              : 'いいねに失敗しました。',
          )
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

        try {
          await supabasePollRepository.submitPollResponse({
            lectureSessionId: activeLectureSessionId,
            optionIds: normalizedOptionIds,
            participantId: currentParticipantId,
            pollId,
          })
          setPollResponses((current) =>
            mergeLocalPollResponse({
              currentResponses: current,
              optionIds: normalizedOptionIds,
              participantId: currentParticipantId,
              pollId,
            }),
          )
        } catch (error) {
          setPollsError(
            error instanceof Error
              ? `Poll回答に失敗しました: ${error.message}`
              : 'Poll回答に失敗しました。',
          )
        }
      },
    }),
    [
      comments,
      activeLectureSessionId,
      baseLecture,
      commentsError,
      commentsLoading,
      commentLikesError,
      canInteract,
      currentParticipantId,
      hasActiveLectureSessionId,
      hiddenCommentCount,
      isSubmittingComment,
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
      recordSessionActivity,
      resetDemoLecture,
      resumeSessionSync,
      selectLectureSession,
      sessionSyncPauseReason,
      refreshComments,
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
