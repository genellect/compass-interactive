import type {
  AdminLecture,
  AdminPoll,
} from '../../repositories/supabaseAdminRepository'

export type TeacherWorkspaceView = 'setup' | 'slides' | 'participation' | 'ai'

export function deriveTeacherWorkspacePresentation(input: {
  activeLecture: AdminLecture | undefined
  hasPublishedMaterial: boolean
}) {
  const status = input.activeLecture?.status ?? null
  const lectureIsOpen = status === 'open'
  const lectureIsEditable = Boolean(input.activeLecture) && status !== 'closed'
  const canShowSlides = lectureIsEditable && input.hasPublishedMaterial

  return {
    canShowAi: lectureIsEditable,
    canShowParticipation: lectureIsEditable,
    canShowSlides,
    defaultView: (lectureIsOpen && canShowSlides
      ? 'slides'
      : 'setup') as TeacherWorkspaceView,
    headerDescription: input.activeLecture
      ? null
      : '資料を選び、講義タイトルを設定して開始します。',
    headerTitle: input.activeLecture?.title ?? '講義を準備する',
  }
}

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

export function fromDatetimeLocalValue(value: string) {
  return value ? new Date(value).toISOString() : null
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
    : orderedLectures
        .filter((lecture) => lecture.status !== 'closed')
        .slice(0, 2)
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
