import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { demoRepository } from '../src/demo/demoRepository.ts'
import { DEMO_STORAGE_KEY } from '../src/demo/demoStorage.ts'

const learningSupportSource = readFileSync(
  new URL('../src/components/LearningSupport/LearningSupport.tsx', import.meta.url),
  'utf8',
)
const lecturePageSource = readFileSync(
  new URL('../src/pages/LecturePage.tsx', import.meta.url),
  'utf8',
)
const adminPageSource = readFileSync(
  new URL('../src/pages/AdminPage.tsx', import.meta.url),
  'utf8',
)

class MemoryStorage {
  #values = new Map()

  getItem(key) {
    return this.#values.get(key) ?? null
  }

  removeItem(key) {
    this.#values.delete(key)
  }

  setItem(key, value) {
    this.#values.set(key, value)
  }
}

const storage = new MemoryStorage()
const initial = demoRepository.getSnapshot(storage)

assert.equal(initial.session.runtimeMode, 'demo')
assert.equal(initial.displayState.pdfDocumentId, 'why-learn-english-v1')
assert.equal(initial.displayState.currentPdfPage, 3)
assert.equal(
  initial.polls[0]?.options[0]?.label,
  '世界中の仲間と一緒に挑戦できる',
)
assert.equal(initial.comments.length, 3)
assert.equal(initial.pollResponses.length, 0)
assert.ok(storage.getItem(DEMO_STORAGE_KEY))
assert.match(learningSupportSource, /5 MINUTE RECAP/)
assert.match(learningSupportSource, /直近5分のハイライト/)
assert.match(learningSupportSource, /講演者のポイント/)
assert.match(learningSupportSource, /みんなの反応/)
assert.match(learningSupportSource, /MATERIAL SUMMARY/)
assert.match(learningSupportSource, /講義資料の要点/)
assert.match(lecturePageSource, /lecture-area-recap/)
assert.doesNotMatch(adminPageSource, /API接続待ち/)

const withComment = demoRepository.addComment(
  '端末内テストコメント',
  'デモ参加者',
  storage,
)
assert.equal(withComment.comments[0]?.body, '端末内テストコメント')
assert.equal(withComment.comments[0]?.nickname, 'デモ参加者')

const liked = demoRepository.addCommentLike('demo-comment-2', storage)
assert.equal(
  liked.comments.find((comment) => comment.id === 'demo-comment-2')?.likeCount,
  19,
)

const answered = demoRepository.submitPollResponse(
  'demo-poll-1',
  ['demo-option-3'],
  storage,
)
assert.equal(answered.pollResponses.length, 1)
assert.equal(
  answered.pollResults.find((result) => result.optionId === 'demo-option-3')
    ?.responseCount,
  44,
)

assert.throws(
  () =>
    demoRepository.submitPollResponse(
      'demo-poll-1',
      ['demo-option-1'],
      storage,
    ),
  /回答済み/,
)

const restored = demoRepository.getSnapshot(storage)
assert.equal(restored.comments[0]?.body, '端末内テストコメント')
assert.equal(restored.comments[0]?.nickname, 'デモ参加者')
assert.equal(restored.pollResponses.length, 1)

const ambientBodies = [
  '英語能力とAIリテラシーは相関しますか？',
  'すごい',
  'この説明わかりやすいです！',
  'TOEIC申し込んでみようと思います！',
]

for (const [index, body] of ambientBodies.entries()) {
  const snapshot = demoRepository.addNextAmbientComment(storage)
  assert.equal(snapshot.comments.length, 5 + index)
  assert.equal(snapshot.comments[0]?.body, body)
}

const afterAllAmbientComments = demoRepository.addNextAmbientComment(storage)
assert.equal(afterAllAmbientComments.comments.length, 8)
for (const body of ambientBodies) {
  assert.equal(
    afterAllAmbientComments.comments.filter((comment) => comment.body === body)
      .length,
    1,
  )
}

const reset = demoRepository.reset(storage)
assert.equal(reset.comments.length, 3)
assert.equal(reset.pollResponses.length, 0)
assert.notEqual(reset.participant.id, initial.participant.id)

console.log('DEMO repository tests passed.')
