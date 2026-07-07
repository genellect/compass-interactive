import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
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

export function CompassStateProvider({ children }: { children: ReactNode }) {
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
  const [realtimeCommentLikesStatus, setRealtimeCommentLikesStatus] =
    useState<CompassStateValue['realtimeCommentLikesStatus']>('idle')
  const [realtimePollResultsStatus, setRealtimePollResultsStatus] =
    useState<CompassStateValue['realtimePollResultsStatus']>('idle')

  const refreshComments = useCallback(async () => {
    if (!hasActiveLectureSessionId) {
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
      setComments(remoteComments)

      try {
        const remoteLikes =
          await supabaseCommentRepository.listCommentLikesForVisibleComments(
            activeLectureSessionId,
          )
        setComments(applyCommentLikes(remoteComments, remoteLikes))
      } catch (error) {
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
  }, [activeLectureSessionId, hasActiveLectureSessionId])

  useEffect(() => {
    void refreshComments()
  }, [refreshComments])

  const refreshPollResults = useCallback(async () => {
    if (!hasActiveLectureSessionId) {
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
  }, [activeLectureSessionId, hasActiveLectureSessionId])

  useEffect(() => {
    if (!hasActiveLectureSessionId) {
      setPolls([])
      setPollResponses([])
      return
    }

    async function refreshPolls() {
      setPollsLoading(true)
      setPollsError(null)

      try {
        const remotePolls =
          await supabasePollRepository.listOpenPolls(activeLectureSessionId)
        setPolls(remotePolls)
        setUsingSupabasePolls(true)
        void refreshPollResults()
        setPollResponses(
          restoreLocalPollResponses(),
        )
      } catch (error) {
        setUsingSupabasePolls(false)
        setPolls(mockPolls)
        setPollResponses(mockPollResponses)
        setPollsError(
          error instanceof Error
            ? `Pollの取得に失敗しました。mock Pollを表示しています: ${error.message}`
            : 'Pollの取得に失敗しました。mock Pollを表示しています。',
        )
      } finally {
        setPollsLoading(false)
      }
    }

    void refreshPolls()
  }, [
    activeLectureSessionId,
    currentParticipantId,
    hasActiveLectureSessionId,
    refreshPollResults,
  ])

  useEffect(() => {
    if (!hasActiveLectureSessionId) {
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
  }, [activeLectureSessionId, hasActiveLectureSessionId])

  useEffect(() => {
    if (!hasActiveLectureSessionId) {
      setRealtimeCommentLikesStatus('unavailable')
      return
    }

    try {
      return supabaseCommentRepository.subscribeToCommentLikeInserts({
        lectureSessionId: activeLectureSessionId,
        onLike: (like) => {
          setComments((current) =>
            mergeLocalCommentLike(
              current,
              like.comment_id,
              like.participant_id,
            ),
          )
        },
        onStatusChange: setRealtimeCommentLikesStatus,
      })
    } catch {
      setRealtimeCommentLikesStatus('unavailable')
      return
    }
  }, [activeLectureSessionId, hasActiveLectureSessionId])

  useEffect(() => {
    if (!hasActiveLectureSessionId) {
      setRealtimePollResultsStatus('unavailable')
      return
    }

    try {
      return supabasePollRepository.subscribeToPollResultRefreshEvents({
        lectureSessionId: activeLectureSessionId,
        onRefresh: () => {
          void refreshPollResults()
        },
        onStatusChange: setRealtimePollResultsStatus,
      })
    } catch {
      setRealtimePollResultsStatus('unavailable')
      return
    }
  }, [activeLectureSessionId, hasActiveLectureSessionId, refreshPollResults])

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
      realtimeCommentLikesStatus,
      realtimePollResultsStatus,
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

        setIsSubmittingComment(true)
        setCommentsError(null)

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

        const targetComment = comments.find((comment) => comment.id === commentId)

        if (!targetComment || targetComment.status !== 'visible') {
          return
        }

        if (targetComment.likedByParticipantIds.includes(currentParticipantId)) {
          setCommentLikesError('いいね取消はPhase 2-Fでは未実装です。')
          return
        }

        setCommentLikesError(null)

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
      realtimeCommentLikesStatus,
      realtimePollResultsStatus,
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
