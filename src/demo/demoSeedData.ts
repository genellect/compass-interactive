import type { LectureSession, LiveComment, Poll } from '../types/index.ts'
import type { PollResultSummary } from '../repositories/supabasePollRepository.ts'
import type { DisplayState } from '../repositories/supabaseDisplayStateRepository.ts'

export const DEMO_LECTURE_CODE = 'DEMO'
export const DEMO_LECTURE_ID = 'compass-demo-lecture'

export const demoLecture: LectureSession = {
  id: DEMO_LECTURE_ID,
  title: 'AI時代の英語と学び',
  codeLabel: DEMO_LECTURE_CODE,
  codeHash: '',
  status: 'open',
  expectedParticipants: 218,
  createdAt: '2026-01-01T00:00:00.000Z',
}

export const demoDisplayState: DisplayState = {
  lectureSessionId: DEMO_LECTURE_ID,
  pdfDocumentId: 'why-learn-english-v1',
  pdfDocumentVersion: null,
  pdfManifestVersion: 0,
  pdfPageCount: 15,
  pdfVisible: true,
  currentPdfPage: 3,
  displayMode: 'normal',
  updatedAt: '2026-01-01T00:05:00.000Z',
}

export const demoSeedComments: LiveComment[] = [
  {
    id: 'demo-comment-1',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-seed-participant-1',
    nickname: '英語学習中',
    body: '翻訳結果が正しいか判断するには、自分にも基礎が必要だと思いました。',
    likeCount: 27,
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
    nickname: null,
    body: '海外の研究者と直接話す力は、翻訳だけでは補いにくそうです。',
    likeCount: 18,
    likedByParticipantIds: ['demo-seed-like-5', 'demo-seed-like-6'],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-01-01T00:02:00.000Z',
  },
  {
    id: 'demo-comment-3',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-seed-participant-3',
    nickname: '質問係',
    body: '英語を学ぶ目的を、点数以外で初めて考えました。',
    likeCount: 9,
    likedByParticipantIds: ['demo-seed-like-7'],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-01-01T00:01:00.000Z',
  },
]

export const demoAmbientComments: LiveComment[] = [
  {
    id: 'demo-ambient-comment-1',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-ambient-participant-1',
    nickname: null,
    body: '英語能力とAIリテラシーは相関しますか？',
    likeCount: 12,
    likedByParticipantIds: [],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-01-01T00:06:00.000Z',
  },
  {
    id: 'demo-ambient-comment-2',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-ambient-participant-2',
    nickname: 'Mina',
    body: 'すごい',
    likeCount: 4,
    likedByParticipantIds: [],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-01-01T00:06:10.000Z',
  },
  {
    id: 'demo-ambient-comment-3',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-ambient-participant-3',
    nickname: null,
    body: 'この説明わかりやすいです！',
    likeCount: 8,
    likedByParticipantIds: [],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-01-01T00:06:20.000Z',
  },
  {
    id: 'demo-ambient-comment-4',
    lectureId: DEMO_LECTURE_ID,
    participantId: 'demo-ambient-participant-4',
    nickname: 'Riku',
    body: 'TOEIC申し込んでみようと思います！',
    likeCount: 6,
    likedByParticipantIds: [],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-01-01T00:06:30.000Z',
  },
]

export const demoPolls: Poll[] = [
  {
    id: 'demo-poll-1',
    lectureId: DEMO_LECTURE_ID,
    question: '翻訳AIが使える今、英語を学ぶ価値として最も大きいものは？',
    type: 'single',
    status: 'open',
    createdAt: '2026-01-01T00:04:00.000Z',
    options: [
      {
        id: 'demo-option-1',
        pollId: 'demo-poll-1',
        label: '世界中の仲間と一緒に挑戦できる',
        order: 1,
      },
      {
        id: 'demo-option-2',
        pollId: 'demo-poll-1',
        label: '海外の人と直接関係を築ける',
        order: 2,
      },
      {
        id: 'demo-option-3',
        pollId: 'demo-poll-1',
        label: '異なる文化や考え方に触れられる',
        order: 3,
      },
      {
        id: 'demo-option-4',
        pollId: 'demo-poll-1',
        label: '試験や資格に役立つ',
        order: 4,
      },
    ],
  },
]

export const demoSeedPollResults: PollResultSummary[] = [
  { pollId: 'demo-poll-1', optionId: 'demo-option-1', responseCount: 86 },
  { pollId: 'demo-poll-1', optionId: 'demo-option-2', responseCount: 61 },
  { pollId: 'demo-poll-1', optionId: 'demo-option-3', responseCount: 43 },
  { pollId: 'demo-poll-1', optionId: 'demo-option-4', responseCount: 18 },
]
