import type {
  LectureSession,
  LiveComment,
  Participant,
  Poll,
  PollResponse,
} from '../types'

export const MOCK_LECTURE_CODE = 'JC2026'

export const mockLectureSession: LectureSession = {
  id: '77777777-7777-4777-8777-777777777777',
  title: 'Journal Club MVP',
  codeLabel: MOCK_LECTURE_CODE,
  codeHash: 'mock-hash-not-for-production',
  status: 'open',
  expectedParticipants: 20,
  createdAt: '2026-07-07T09:00:00+09:00',
  startsAt: '2026-07-07T10:30:00+09:00',
  expiresAt: '2026-12-31T23:59:59+09:00',
  feedbackFormUrl: 'https://forms.gle/example',
}

export const mockParticipants: Participant[] = [
  {
    id: 'anon-0001',
    lectureId: mockLectureSession.id,
    joinedAt: '2026-07-04T10:31:12+09:00',
    lastSeenAt: '2026-07-04T10:45:10+09:00',
  },
  {
    id: 'anon-0002',
    lectureId: mockLectureSession.id,
    joinedAt: '2026-07-04T10:32:04+09:00',
    lastSeenAt: '2026-07-04T10:45:22+09:00',
  },
  {
    id: 'anon-0003',
    lectureId: mockLectureSession.id,
    joinedAt: '2026-07-04T10:33:18+09:00',
    lastSeenAt: '2026-07-04T10:45:30+09:00',
  },
]

export const mockComments: LiveComment[] = [
  {
    id: 'comment-001',
    lectureId: mockLectureSession.id,
    participantId: 'anon-0001',
    body: '英語論文を読むとき、最初にどこから見ればよいか知りたいです。',
    likeCount: 18,
    likedByParticipantIds: [],
    status: 'visible',
    isPinned: true,
    createdAt: '2026-07-04T10:40:01+09:00',
  },
  {
    id: 'comment-002',
    lectureId: mockLectureSession.id,
    participantId: 'anon-0002',
    body: 'TOEICと薬学英語の勉強をどう両立するかが不安です。',
    likeCount: 27,
    likedByParticipantIds: [],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-07-04T10:41:21+09:00',
  },
  {
    id: 'comment-003',
    lectureId: mockLectureSession.id,
    participantId: 'anon-0003',
    body: '将来、海外の研究室にも少し興味があります。',
    likeCount: 9,
    likedByParticipantIds: [],
    status: 'visible',
    isPinned: false,
    createdAt: '2026-07-04T10:42:14+09:00',
  },
  {
    id: 'comment-004',
    lectureId: mockLectureSession.id,
    participantId: 'anon-0002',
    body: '管理者だけが確認する非表示コメントの例です。',
    likeCount: 0,
    likedByParticipantIds: [],
    status: 'hidden',
    isPinned: false,
    createdAt: '2026-07-04T10:43:02+09:00',
  },
]

export const mockPolls: Poll[] = [
  {
    id: '77777777-7777-4777-8777-777777778701',
    lectureId: mockLectureSession.id,
    question:
      '1. この論文で最も「治療の本質」だと思うものは？\nこの研究で最も重要なアイデアはどれだと思いますか？',
    type: 'single',
    status: 'open',
    createdAt: '2026-07-07T10:35:00+09:00',
    options: [
      {
        id: '77777777-7777-4777-8777-777777781101',
        pollId: '77777777-7777-4777-8777-777777778701',
        label: 'A. CRISPRでDNAを編集すること',
        order: 1,
      },
      {
        id: '77777777-7777-4777-8777-777777781102',
        pollId: '77777777-7777-4777-8777-777777778701',
        label: 'B. RNAだけを狙い、DNAを変えないこと',
        order: 2,
      },
      {
        id: '77777777-7777-4777-8777-777777781103',
        pollId: '77777777-7777-4777-8777-777777778701',
        label: 'C. senseとantisenseを同時に標的化したこと',
        order: 3,
      },
      {
        id: '77777777-7777-4777-8777-777777781104',
        pollId: '77777777-7777-4777-8777-777777778701',
        label: 'D. マウス実験まで成功したこと',
        order: 4,
      },
    ],
  },
  {
    id: '77777777-7777-4777-8777-777777778702',
    lectureId: mockLectureSession.id,
    question:
      '2. もしあなたが製薬企業の研究責任者なら、次に一番お金をかける実験は？',
    type: 'single',
    status: 'open',
    createdAt: '2026-07-07T10:36:00+09:00',
    options: [
      {
        id: '77777777-7777-4777-8777-777777782101',
        pollId: '77777777-7777-4777-8777-777777778702',
        label: 'A. 成人マウスへの投与',
        order: 1,
      },
      {
        id: '77777777-7777-4777-8777-777777782102',
        pollId: '77777777-7777-4777-8777-777777778702',
        label: 'B. 長期安全性評価',
        order: 2,
      },
      {
        id: '77777777-7777-4777-8777-777777782103',
        pollId: '77777777-7777-4777-8777-777777778702',
        label: 'C. Delivery効率改善',
        order: 3,
      },
      {
        id: '77777777-7777-4777-8777-777777782104',
        pollId: '77777777-7777-4777-8777-777777778702',
        label: 'D. サルなど大型動物で検証',
        order: 4,
      },
    ],
  },
  {
    id: '77777777-7777-4777-8777-777777778703',
    lectureId: mockLectureSession.id,
    question: '3. この論文で一番難しい課題は何だと思いますか？',
    type: 'single',
    status: 'open',
    createdAt: '2026-07-07T10:37:00+09:00',
    options: [
      {
        id: '77777777-7777-4777-8777-777777783101',
        pollId: '77777777-7777-4777-8777-777777778703',
        label: 'A. CasRxそのもの',
        order: 1,
      },
      {
        id: '77777777-7777-4777-8777-777777783102',
        pollId: '77777777-7777-4777-8777-777777778703',
        label: 'B. オフターゲット',
        order: 2,
      },
      {
        id: '77777777-7777-4777-8777-777777783103',
        pollId: '77777777-7777-4777-8777-777777778703',
        label: 'C. 脳へ十分届けるDelivery',
        order: 3,
      },
      {
        id: '77777777-7777-4777-8777-777777783104',
        pollId: '77777777-7777-4777-8777-777777778703',
        label: 'D. 免疫反応',
        order: 4,
      },
    ],
  },
  {
    id: '77777777-7777-4777-8777-777777778704',
    lectureId: mockLectureSession.id,
    question: '4. CasRxはCas9と何が最も違うでしょう？',
    type: 'single',
    status: 'open',
    createdAt: '2026-07-07T10:38:00+09:00',
    options: [
      {
        id: '77777777-7777-4777-8777-777777784101',
        pollId: '77777777-7777-4777-8777-777777778704',
        label: 'A. DNAを切る',
        order: 1,
      },
      {
        id: '77777777-7777-4777-8777-777777784102',
        pollId: '77777777-7777-4777-8777-777777778704',
        label: 'B. RNAを標的にする',
        order: 2,
      },
      {
        id: '77777777-7777-4777-8777-777777784103',
        pollId: '77777777-7777-4777-8777-777777778704',
        label: 'C. タンパク質を分解する',
        order: 3,
      },
      {
        id: '77777777-7777-4777-8777-777777784104',
        pollId: '77777777-7777-4777-8777-777777778704',
        label: 'D. RNA polymeraseを阻害する',
        order: 4,
      },
    ],
  },
  {
    id: '77777777-7777-4777-8777-777777778705',
    lectureId: mockLectureSession.id,
    question: '5. あなたなら、この治療法をALS患者に使いたいと思いますか？',
    type: 'single',
    status: 'open',
    createdAt: '2026-07-07T10:39:00+09:00',
    options: [
      {
        id: '77777777-7777-4777-8777-777777785101',
        pollId: '77777777-7777-4777-8777-777777778705',
        label: 'A. 今すぐ使いたい',
        order: 1,
      },
      {
        id: '77777777-7777-4777-8777-777777785102',
        pollId: '77777777-7777-4777-8777-777777778705',
        label: 'B. Phase Iなら参加したい',
        order: 2,
      },
      {
        id: '77777777-7777-4777-8777-777777785103',
        pollId: '77777777-7777-4777-8777-777777778705',
        label: 'C. まだ動物実験が必要',
        order: 3,
      },
      {
        id: '77777777-7777-4777-8777-777777785104',
        pollId: '77777777-7777-4777-8777-777777778705',
        label: 'D. 現段階では慎重であるべき',
        order: 4,
      },
    ],
  },
]

export const mockPollResponses: PollResponse[] = []
