import assert from 'node:assert/strict'
import { demoRepository } from '../src/demo/demoRepository.ts'
import { DEMO_STORAGE_KEY } from '../src/demo/demoStorage.ts'

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
assert.equal(initial.displayState.currentPdfPage, 6)
assert.equal(initial.comments.length, 3)
assert.equal(initial.pollResponses.length, 0)
assert.ok(storage.getItem(DEMO_STORAGE_KEY))

const withComment = demoRepository.addComment('端末内テストコメント', storage)
assert.equal(withComment.comments[0]?.body, '端末内テストコメント')

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
assert.equal(restored.pollResponses.length, 1)

const reset = demoRepository.reset(storage)
assert.equal(reset.comments.length, 3)
assert.equal(reset.pollResponses.length, 0)
assert.notEqual(reset.participant.id, initial.participant.id)

console.log('DEMO repository tests passed.')
