import { useRef, type Dispatch, type SetStateAction } from 'react'
import type { AdminOperationCredential } from '../../lib/adminAuth/adminOperationCredential'
import {
  type AdminPollList,
  supabaseAdminRepository,
} from '../../repositories/supabaseAdminRepository'

type PollMutation = {
  epoch: number
  lectureSessionId: string
}

export function useAdminPollRefreshCoordinator(input: {
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredential | null
  applyPollList: (result: AdminPollList, lectureSessionId: string) => void
  clearPollList: () => void
  handleInvalidAdminSession: (error: unknown) => boolean
  journalClubLectureIds: ReadonlySet<string>
  setPollsError: Dispatch<SetStateAction<string | null>>
  setPollsLoading: Dispatch<SetStateAction<boolean>>
  showPollHistory: boolean
}) {
  const inFlightByKeyRef = useRef(new Map<string, number>())
  const refreshSequenceRef = useRef(0)
  const mutationEpochRef = useRef(0)
  const activeLectureIdRef = useRef<string | null>(null)
  activeLectureIdRef.current = input.activeLectureSessionId

  function beginPollMutation(lectureSessionId: string): PollMutation {
    input.setPollsLoading(true)
    input.setPollsError(null)
    return {
      epoch: ++mutationEpochRef.current,
      lectureSessionId,
    }
  }

  function pollMutationIsCurrent(mutation: PollMutation) {
    return (
      mutation.epoch === mutationEpochRef.current &&
      mutation.lectureSessionId === activeLectureIdRef.current
    )
  }

  function finishPollMutation(mutation: PollMutation) {
    if (mutation.epoch === mutationEpochRef.current) {
      input.setPollsLoading(false)
    }
  }

  function invalidatePollMutations() {
    mutationEpochRef.current += 1
  }

  async function refreshAdminPolls(
    lectureSessionId = input.activeLectureSessionId,
    token = input.adminToken,
    includeHistory = input.showPollHistory,
    silent = false,
  ) {
    if (!lectureSessionId || !token) {
      refreshSequenceRef.current += 1
      input.clearPollList()
      return false
    }
    const effectiveIncludeHistory =
      includeHistory || input.journalClubLectureIds.has(lectureSessionId)
    const refreshKey = `${lectureSessionId}:${effectiveIncludeHistory}`
    if (silent && inFlightByKeyRef.current.has(refreshKey)) return false

    const refreshSequence = ++refreshSequenceRef.current
    const mutationEpoch = mutationEpochRef.current
    inFlightByKeyRef.current.set(refreshKey, refreshSequence)
    if (!silent) {
      input.setPollsLoading(true)
      input.setPollsError(null)
    }

    try {
      const result = await supabaseAdminRepository.managePolls({
        action: 'list',
        adminToken: token,
        includeHistory: effectiveIncludeHistory,
        lectureSessionId,
      })
      if (
        refreshSequence !== refreshSequenceRef.current ||
        mutationEpoch !== mutationEpochRef.current ||
        lectureSessionId !== activeLectureIdRef.current
      ) {
        return false
      }
      input.applyPollList(result, lectureSessionId)
      return true
    } catch (error) {
      if (input.handleInvalidAdminSession(error)) return false
      if (
        !silent &&
        refreshSequence === refreshSequenceRef.current &&
        mutationEpoch === mutationEpochRef.current &&
        lectureSessionId === activeLectureIdRef.current
      ) {
        input.setPollsError(
          error instanceof Error
            ? `投票一覧の取得に失敗しました: ${error.message}`
            : '投票一覧の取得に失敗しました。',
        )
      }
      return false
    } finally {
      if (inFlightByKeyRef.current.get(refreshKey) === refreshSequence) {
        inFlightByKeyRef.current.delete(refreshKey)
      }
      if (
        !silent &&
        refreshSequence === refreshSequenceRef.current &&
        mutationEpoch === mutationEpochRef.current
      ) {
        input.setPollsLoading(false)
      }
    }
  }

  return {
    beginPollMutation,
    finishPollMutation,
    invalidatePollMutations,
    pollMutationIsCurrent,
    refreshAdminPolls,
  }
}
