import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { mockPollResponses, mockPolls } from '../lib/mockData'
import {
  createParticipantId,
  isParticipantUuid,
  persistLocalParticipantIdentity,
  restoreLocalParticipantId,
} from '../lib/participantIdentity'
import {
  JOURNAL_CLUB_MVP_CODE,
  persistJoinedLectureSession,
  restoreJoinedLectureSession,
  type JoinedLectureSession,
} from '../lib/joinedLecture'
import { HIDDEN_SYNC_STOP_MS, IDLE_SYNC_TIMEOUT_MS } from '../lib/liveSync'
import { mockCompassRepository } from '../repositories'
import {
  type CommentLikeRow,
  supabaseCommentRepository,
} from '../repositories/supabaseCommentRepository'
import { supabaseLectureRepository } from '../repositories/supabaseLectureRepository'
import { supabasePollRepository } from '../repositories/supabasePollRepository'
import type { PollResultSummary } from '../repositories/supabasePollRepository'
import type {
  LectureSession,
  LiveComment,
  Participant,
  Poll,
  PollResponse,
} from '../types'
import { createOrUpdateParticipant } from '../services/compassActions'
import { useAdaptiveLiveSync } from '../hooks/useAdaptiveLiveSync'
import { CompassStateContext, type CompassStateValue } from './CompassStateValue'

const LEGACY_LOCAL_POLL_RESPONSE_STORAGE_PREFIX =
  'compass-interactive-local-poll-responses'

function clearLegacyLocalPollResponses() {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return
  }

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index)

    if (key?.startsWith(LEGACY_LOCAL_POLL_RESPONSE_STORAGE_PREFIX)) {
      window.localStorage.removeItem(key)
    }
  }
}

function restoreLocalPollResponses(): PollResponse[] {
  clearLegacyLocalPollResponses()
  return []
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
        !(response.pollId === pollId && response.participantId === participantId),
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

function applyCommentLikes(
  currentComments: LiveComment[],
  likes: CommentLikeRow[],
) {
  const participantIdsByComment = new Map<string, Set<string>>()

  for (const like of likes) {
    const participantIds =
      participantIdsByComment.get(like.comment_id) ?? new Set<string>()
    participantIds.add(like.participant_id)
    participantIdsByComment.set(like.comment_id, participantIds)
  }

  return currentComments.map((comment) => {
    const participantIds = participantIdsByComment.get(comment.id)

    if (!participantIds) {
      return {
        ...comment,
        likeCount: 0,
        likedByParticipantIds: [],
      }
    }

    return {
      ...comment,
      likeCount: participantIds.size,
      likedByParticipantIds: Array.from(participantIds),
    }
  })
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
  const hasActiveLectureSessionId = activeLectureSessionId.length > 0
  const lecture = useMemo<LectureSession>(
    () =>
      joinedLectureSession
        ? {
            ...baseLecture,
            codeLabel: JOURNAL_CLUB_MVP_CODE,
            expectedParticipants: 20,
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
  const [currentParticipantId, setCurrentParticipantId] = useState<string | null>(
    () =>
      activeLectureSessionId
        ? restoreLocalParticipantId(activeLectureSessionId)
        : restoreLocalParticipantId(),
  )
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [commentLikesError, setCommentLikesError] = useState<string | null>(null)
  const [pollsError, setPollsError] = useState<string | null>(null)
  const [pollResultsError, setPollResultsError] = useState<string | null>(null)
  const [pollsLoading, setPollsLoading] = useState(false)
  const [usingSupabasePolls, setUsingSupabasePolls] = useState(false)
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const [realtimeCommentsStatus, setRealtimeCommentsStatus] =
    useState<CompassStateValue['realtimeCommentsStatus']>('idle')
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now())
  const [sessionSyncPauseReason, setSessionSyncPauseReason] =
    useState<CompassStateValue['sessionSyncPauseReason']>(null)
  const isLectureOpen = joinedLectureSession?.status === 'open'
  const isSessionSyncPaused = sessionSyncPauseReason !== null
  const canRunLiveSync =
    hasActiveLectureSessionId && isLectureOpen && !isSessionSyncPaused
  const isLectureRoute = location.pathname === '/lecture'

  const recordSessionActivity = useCallback(() => {
    setLastActivityAt(Date.now())
  }, [])

  const selectLectureSession = useCallback((nextLecture: JoinedLectureSession) => {
    persistJoinedLectureSession(nextLecture)
    setJoinedLectureSession(nextLecture)
    setCurrentParticipantId(restoreLocalParticipantId(nextLecture.id))
    setSessionSyncPauseReason(nextLecture.status === 'closed' ? 'lectureClosed' : null)
    setComments([])
    setPolls([])
    setPollResults([])
    setPollResponses([])
    setCommentsError(null)
    setCommentLikesError(null)
    setPollsError(null)
    setPollResultsError(null)
  }, [])

  const refreshLectureSessionState = useCallback(async () => {
    if (!hasActiveLectureSessionId) {
      return null
    }

    const latestLecture =
      await supabaseLectureRepository.getLectureSessionState(activeLectureSessionId)

    if (!latestLecture) {
      return null
    }

    persistJoinedLectureSession(latestLecture)
    setJoinedLectureSession(latestLecture)

    if (latestLecture.status === 'closed') {
      setSessionSyncPauseReason('lectureClosed')
      setRealtimeCommentsStatus('disconnected')
      return latestLecture
    }

    return latestLecture
  }, [activeLectureSessionId, hasActiveLectureSessionId])

  const refreshComments = useCallback(async () => {
    if (!hasActiveLectureSessionId) {
      setComments([])
      setCommentsError(null)
      return
    }

    if (!isLectureOpen) {
      setComments([])
      setCommentsError(null)
      return
    }

    setCommentsLoading(true)
    setCommentsError(null)
    setCommentLikesError(null)

    try {
      const remoteComments =
        await supabaseCommentRepository.listVisibleComments(activeLectureSessionId)

      try {
        const remoteLikes =
          await supabaseCommentRepository.listCommentLikesForVisibleComments(
            activeLectureSessionId,
          )
        setComments(applyCommentLikes(remoteComments, remoteLikes))
      } catch (error) {
        setComments(remoteComments)
        setCommentLikesError(
          error instanceof Error
            ? `comment_likesの取得に失敗しました: ${error.message}`
            : 'comment_likesの取得に失敗しました。',
        )
      }
    } catch (error) {
      setCommentsError(
        error instanceof Error
          ? error.message
          : 'コメントの取得に失敗しました。',
      )
    } finally {
      setCommentsLoading(false)
    }
  }, [activeLectureSessionId, hasActiveLectureSessionId, isLectureOpen])

  const refreshCommentLikes = useCallback(async () => {
    if (!hasActiveLectureSessionId) {
      setCommentLikesError(null)
      return
    }

    if (!isLectureOpen) {
      setCommentLikesError(null)
      return
    }

    try {
      const remoteLikes =
        await supabaseCommentRepository.listCommentLikesForVisibleComments(
          activeLectureSessionId,
        )
      setComments((current) => applyCommentLikes(current, remoteLikes))
      setCommentLikesError(null)
    } catch (error) {
      setCommentLikesError(
        error instanceof Error
          ? `いいね数の更新に失敗しました: ${error.message}`
          : 'いいね数の更新に失敗しました。',
      )
    }
  }, [activeLectureSessionId, hasActiveLectureSessionId, isLectureOpen])

  useEffect(() => {
    void refreshComments()
  }, [refreshComments])

  const refreshPollResults = useCallback(async () => {
    if (!hasActiveLectureSessionId) {
      setPollResults([])
      setPollResultsError(null)
      return
    }

    if (!isLectureOpen) {
      setPollResults([])
      setPollResultsError(null)
      return
    }

    try {
      const remotePollResults = await supabasePollRepository.listOpenPollResults(
        activeLectureSessionId,
      )
      setPollResults(remotePollResults)
      setPollResultsError(null)
    } catch (error) {
      setPollResults([])
      setPollResultsError(
        error instanceof Error
          ? `Poll結果RPCの取得に失敗しました: ${error.message}`
          : 'Poll結果RPCの取得に失敗しました。',
      )
    }
  }, [activeLectureSessionId, hasActiveLectureSessionId, isLectureOpen])

  const refreshPolls = useCallback(async ({
    resetResponses = false,
    showLoading = false,
  }: {
    resetResponses?: boolean
    showLoading?: boolean
  } = {}) => {
    if (!hasActiveLectureSessionId) {
      setPolls([])
      setPollResponses([])
      setPollsError(null)
      return
    }

    if (!isLectureOpen) {
      setPolls([])
      setPollResponses([])
      setPollsError(null)
      return
    }

    if (showLoading) {
      setPollsLoading(true)
    }

    setPollsError(null)

    try {
      const remotePolls =
        await supabasePollRepository.listOpenPolls(activeLectureSessionId)
      setPolls(remotePolls)
      setUsingSupabasePolls(true)

      if (resetResponses) {
        setPollResponses(
          restoreLocalPollResponses(),
        )
      }
    } catch (error) {
      setUsingSupabasePolls(false)
      setPolls(mockPolls)

      if (resetResponses) {
        setPollResponses(mockPollResponses)
      }

      setPollsError(
        error instanceof Error
          ? `Pollの取得に失敗しました。mock Pollを表示しています: ${error.message}`
          : 'Pollの取得に失敗しました。mock Pollを表示しています。',
      )
    } finally {
      if (showLoading) {
        setPollsLoading(false)
      }
    }
  }, [activeLectureSessionId, hasActiveLectureSessionId, isLectureOpen])

  useEffect(() => {
    if (!hasActiveLectureSessionId || !isLectureOpen || !isLectureRoute) {
      return
    }

    const events = ['keydown', 'pointerdown', 'touchstart'] as const
    for (const eventName of events) {
      window.addEventListener(eventName, recordSessionActivity, { passive: true })
    }

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, recordSessionActivity)
      }
    }
  }, [hasActiveLectureSessionId, isLectureOpen, isLectureRoute, recordSessionActivity])

  useEffect(() => {
    if (
      !hasActiveLectureSessionId ||
      !isLectureOpen ||
      !isLectureRoute ||
      isSessionSyncPaused
    ) {
      return
    }

    const elapsedMs = Date.now() - lastActivityAt
    const remainingMs = IDLE_SYNC_TIMEOUT_MS - elapsedMs

    if (remainingMs <= 0) {
      setSessionSyncPauseReason('idle')
      setRealtimeCommentsStatus('disconnected')
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSessionSyncPauseReason('idle')
      setRealtimeCommentsStatus('disconnected')
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [
    hasActiveLectureSessionId,
    isLectureOpen,
    isLectureRoute,
    isSessionSyncPaused,
    lastActivityAt,
  ])

  useEffect(() => {
    if (!hasActiveLectureSessionId || !isLectureOpen || isSessionSyncPaused) {
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
          setRealtimeCommentsStatus('disconnected')
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
  ])

  const resumeSessionSync = useCallback(async () => {
    if (!hasActiveLectureSessionId || sessionSyncPauseReason === 'lectureClosed') {
      return
    }

    recordSessionActivity()
    const latestLecture = await refreshLectureSessionState()

    if (!latestLecture || latestLecture.status !== 'open') {
      setSessionSyncPauseReason('lectureClosed')
      return
    }

    setSessionSyncPauseReason(null)
    await Promise.allSettled([
      refreshComments(),
      refreshPolls({ resetResponses: true, showLoading: true }),
      refreshPollResults(),
    ])
  }, [
    hasActiveLectureSessionId,
    recordSessionActivity,
    refreshComments,
    refreshLectureSessionState,
    refreshPollResults,
    refreshPolls,
    sessionSyncPauseReason,
  ])

  useEffect(() => {
    void refreshPolls({ resetResponses: true, showLoading: true })
    void refreshPollResults()
  }, [refreshPollResults, refreshPolls])

  const runFiveSecondLiveSync = useCallback(async () => {
    if (!canRunLiveSync) {
      return
    }

    const latestLecture = await refreshLectureSessionState()
    if (!latestLecture || latestLecture.status !== 'open') {
      return
    }

    await Promise.allSettled([
      refreshCommentLikes(),
      refreshPolls(),
      refreshPollResults(),
    ])
  }, [
    canRunLiveSync,
    refreshCommentLikes,
    refreshLectureSessionState,
    refreshPollResults,
    refreshPolls,
  ])

  useAdaptiveLiveSync({
    enabled: canRunLiveSync,
    onSync: runFiveSecondLiveSync,
    runImmediately: false,
  })

  useEffect(() => {
    if (!canRunLiveSync) {
      setRealtimeCommentsStatus('unavailable')
      return
    }

    try {
      return supabaseCommentRepository.subscribeToVisibleCommentInserts({
        lectureSessionId: activeLectureSessionId,
        onComment: (comment) => {
          setComments((current) => mergeVisibleComment(current, comment))
        },
        onStatusChange: setRealtimeCommentsStatus,
      })
    } catch {
      setRealtimeCommentsStatus('unavailable')
      return
    }
  }, [activeLectureSessionId, canRunLiveSync])

  const visibleComments =
    mockCompassRepository.comment.listVisibleComments(comments)
  const openPolls = mockCompassRepository.poll.listOpenPolls(polls)
  const hiddenCommentCount = comments.length - visibleComments.length

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
      expectedLectureCode: JOURNAL_CLUB_MVP_CODE,
      commentsLoading,
      commentsError,
      commentLikesError,
      pollsError,
      pollResultsError,
      pollsLoading,
      isSubmittingComment,
      realtimeCommentsStatus,
      isSessionSyncPaused,
      lastActivityAt,
      resumeSessionSync,
      selectLectureSession,
      sessionSyncMessage: getSessionPauseMessage(sessionSyncPauseReason),
      sessionSyncPauseReason,
      refreshComments,
      refreshPollResults,
      joinLecture: async (lectureCode) => {
        try {
          const joinedLecture =
            await supabaseLectureRepository.joinLectureByCode(lectureCode)
          const restoredParticipantId = restoreLocalParticipantId(
            joinedLecture.id,
          )
          const participantId = isParticipantUuid(restoredParticipantId)
            ? restoredParticipantId
            : createParticipantId()

          persistJoinedLectureSession(joinedLecture)
          persistLocalParticipantIdentity(participantId, joinedLecture.id)
          setSessionSyncPauseReason(null)
          recordSessionActivity()
          await supabaseCommentRepository.ensureAnonymousParticipant({
            lectureSessionId: joinedLecture.id,
            participantId,
          })

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
          setParticipants((current) =>
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

        if (!canRunLiveSync) {
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

        if (!canRunLiveSync) {
          setCommentLikesError(
            getSessionPauseMessage(sessionSyncPauseReason) ??
              '同期停止中のため、いいねできません。',
          )
          return
        }

        const targetComment = comments.find((comment) => comment.id === commentId)

        if (!targetComment || targetComment.status !== 'visible') {
          return
        }

        if (targetComment.likedByParticipantIds.includes(currentParticipantId)) {
          setCommentLikesError('いいね取消はPhase 2-Fでは未実装です。')
          return
        }

        setCommentLikesError(null)
        recordSessionActivity()

        try {
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
      setPollStatus: (pollId, status) => {
        setPolls((current) =>
          mockCompassRepository.poll.setStatus({
            pollId,
            polls: current,
            status,
          }),
        )
      },
      submitPollResponse: async (pollId, optionIds) => {
        if (!currentParticipantId) {
          return
        }

        if (!canRunLiveSync) {
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
          setPollsError('このPollは回答済みです。再回答はPhase 2-Hでは未実装です。')
          return
        }

        if (!usingSupabasePolls || !hasActiveLectureSessionId) {
          setPollResponses((current) =>
            mockCompassRepository.poll.submitResponse({
              optionIds: normalizedOptionIds,
              participantId: currentParticipantId,
              pollId,
              pollResponses: current,
              polls,
            }),
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
          await refreshPollResults()
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
      canRunLiveSync,
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
      polls,
      realtimeCommentsStatus,
      isSessionSyncPaused,
      lastActivityAt,
      recordSessionActivity,
      resumeSessionSync,
      selectLectureSession,
      sessionSyncPauseReason,
      refreshComments,
      refreshPollResults,
      usingSupabasePolls,
      visibleComments,
    ],
  )

  return (
    <CompassStateContext.Provider value={value}>
      {children}
    </CompassStateContext.Provider>
  )
}
