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
  const canShowSlides =
    Boolean(input.activeLecture) && input.hasPublishedMaterial
  const canShowLiveTools = lectureIsOpen

  return {
    canShowAi: canShowLiveTools,
    canShowParticipation: canShowLiveTools,
    canShowSlides,
    defaultView: (lectureIsOpen
      ? canShowSlides
        ? 'slides'
        : 'participation'
      : 'setup') as TeacherWorkspaceView,
    headerDescription: !input.activeLecture
      ? '資料を選び、講義タイトルを設定して開始します。'
      : status === 'open'
        ? '講義中の操作を、必要な画面だけに分けて表示します。'
        : status === 'closed'
          ? '終了した講義です。履歴を確認するか、次の講義を準備できます。'
          : '資料と講義情報を確認してから開始します。',
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
