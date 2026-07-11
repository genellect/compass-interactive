import type { LectureSession, LiveComment, Poll } from '../types/index.ts'
import type { PollResultSummary } from '../repositories/supabasePollRepository.ts'

export const DEMO_LECTURE_CODE = 'DEMO'
export const DEMO_LECTURE_ID = 'compass-demo-lecture'

export const demoLecture: LectureSession = {
  id: DEMO_LECTURE_ID,
  title: 'COMPASS Interactive デモ講義',
  codeLabel: DEMO_LECTURE_CODE,
  codeHash: '',
  status: 'open',
  expectedParticipants: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
}

export const demoSeedComments: LiveComment[] = [
  {
    id: 'demo-comment-1',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-seed-participant-1',
    body: 'この画面では匿名コメント、いいね、Poll回答を端末内だけで試せます。',
    likeCount: 4,
    likedByParticipantIds: [
      'demo-seed-like-1',
      'demo-seed-like-2',
      'demo-seed-like-3',
      'demo-seed-like-4',
    ],
    status: 'visible',
    isPinned: true,
    createdAt: '2026-01-01T00:03:00.000Z',
  },
  {
    id: 'demo-comment-2',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-seed-participant-2',
    body: '質問を投稿すると、この一覧へすぐに追加されます。',
    likeCount: 2,
    likedByParticipantIds: ['demo-seed-like-5', 'demo-seed-like-6'],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-01-01T00:02:00.000Z',
  },
  {
    id: 'demo-comment-3',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-seed-participant-3',
    body: 'ページを再読み込みしても、この端末の操作結果は保持されます。',
    likeCount: 1,
    likedByParticipantIds: ['demo-seed-like-7'],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-01-01T00:01:00.000Z',
  },
]

export const demoPolls: Poll[] = [
  {
    id: 'demo-poll-1',
    lectureId: DEMO_LECTURE_ID,
    question: 'このデモで最初に試したい機能は？',
    type: 'single',
    status: 'open',
    createdAt: '2026-01-01T00:04:00.000Z',
    options: [
      {
        id: 'demo-option-1',
        pollId: 'demo-poll-1',
        label: '匿名コメント',
        order: 1,
      },
      {
        id: 'demo-option-2',
        pollId: 'demo-poll-1',
        label: 'コメントへのいいね',
        order: 2,
      },
      {
        id: 'demo-option-3',
        pollId: 'demo-poll-1',
        label: 'Poll回答と集計',
        order: 3,
      },
      {
        id: 'demo-option-4',
        pollId: 'demo-poll-1',
        label: '再読み込み後の状態保持',
        order: 4,
      },
    ],
  },
]

export const demoSeedPollResults: PollResultSummary[] = [
  { pollId: 'demo-poll-1', optionId: 'demo-option-1', responseCount: 8 },
  { pollId: 'demo-poll-1', optionId: 'demo-option-2', responseCount: 5 },
  { pollId: 'demo-poll-1', optionId: 'demo-option-3', responseCount: 11 },
  { pollId: 'demo-poll-1', optionId: 'demo-option-4', responseCount: 4 },
]
