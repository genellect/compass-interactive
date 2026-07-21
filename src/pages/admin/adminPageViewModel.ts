import type {
  AdminLecture,
  AdminPoll,
} from '../../repositories/supabaseAdminRepository'

export function makeJoinedLecture(lecture: AdminLecture) {
  return {
    id: lecture.id,
    runtimeMode: 'live' as const,
    status: lecture.status,
    title: lecture.title,
    ...(lecture.startsAt ? { startsAt: lecture.startsAt } : {}),
    ...(lecture.endsAt ? { endsAt: lecture.endsAt } : {}),
  }
}

export function buildAdminPageView(input: {
  activeLectureSessionId: string | null
  adminPolls: AdminPoll[]
  adminPollsHasMore: boolean
  lectures: AdminLecture[]
  showLectureHistory: boolean
  showPollHistory: boolean
}) {
  const activeAdminLecture = input.lectures.find(
    (lecture) => lecture.id === input.activeLectureSessionId,
  )
  const activeJournalClubRun = activeAdminLecture?.journalClub ?? null
  const orderedLectures = [...input.lectures].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )
  const visibleLectures = input.showLectureHistory
    ? orderedLectures
    : orderedLectures.slice(0, 2)
  const orderedAdminPolls = [...input.adminPolls].sort((left, right) => {
    if (activeJournalClubRun) {
      const leftOrder = left.templateOrder ?? Number.MAX_SAFE_INTEGER
      const rightOrder = right.templateOrder ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
    }
    if (left.status === 'open' && right.status !== 'open') return -1
    if (left.status !== 'open' && right.status === 'open') return 1
    return Date.parse(right.createdAt) - Date.parse(left.createdAt)
  })
  const recentAdminPolls = orderedAdminPolls.filter(
    (poll) => poll.status !== 'open',
  )
  const visibleAdminPolls = input.showPollHistory
    ? orderedAdminPolls
    : activeJournalClubRun
      ? orderedAdminPolls
      : [
          ...orderedAdminPolls.filter((poll) => poll.status === 'open'),
          ...recentAdminPolls.slice(0, 5),
        ]

  return {
    activeAdminLecture,
    activeJournalClubRun,
    canShowPollHistory:
      !activeJournalClubRun &&
      (input.showPollHistory ||
        input.adminPollsHasMore ||
        recentAdminPolls.length > 5),
    journalClubLectureIds: new Set(
      input.lectures
        .filter((lecture) => lecture.journalClub)
        .map((lecture) => lecture.id),
    ),
    orderedLectures,
    visibleAdminPolls,
    visibleLectures,
  }
}
