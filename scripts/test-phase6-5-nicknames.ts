import assert from 'node:assert/strict'
import test from 'node:test'
import { demoRepository } from '../src/demo/demoRepository.ts'
import { DEMO_STORAGE_KEY } from '../src/demo/demoStorage.ts'
import {
  MAX_COMMENT_NICKNAME_LENGTH,
  normalizeCommentNickname,
} from '../src/lib/commentNickname.ts'
import { createOptimisticComment } from '../src/lib/optimisticComments.ts'

class MemoryStorage {
  values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

test('normalizes optional nicknames without creating an identity value', () => {
  assert.equal(MAX_COMMENT_NICKNAME_LENGTH, 10)
  assert.equal(normalizeCommentNickname(null), null)
  assert.equal(normalizeCommentNickname('  \n\t '), null)
  assert.equal(normalizeCommentNickname('  研究　好き\u200B  '), '研究 好き')
  assert.equal(
    Array.from(normalizeCommentNickname('😀'.repeat(30)) ?? '').length,
    MAX_COMMENT_NICKNAME_LENGTH,
  )
})

test('optimistic comment carries the exact nullable per-comment nickname', () => {
  const named = createOptimisticComment({
    body: '質問です',
    id: 'optimistic-nickname',
    lectureId: 'lecture-1',
    nickname: '  質問係  ',
    participantId: 'participant-1',
  })
  const anonymous = createOptimisticComment({
    body: '匿名です',
    id: 'optimistic-anonymous',
    lectureId: 'lecture-1',
    participantId: 'participant-1',
  })
  assert.equal(named.nickname, '質問係')
  assert.equal(anonymous.nickname, null)
})

test('demo nickname remains inside the versioned browser storage', () => {
  const storage = new MemoryStorage()
  const named = demoRepository.addComment(
    '端末内のニックネーム投稿',
    '  デモ参加者  ',
    storage,
  )
  assert.equal(named.comments[0]?.nickname, 'デモ参加者')

  const anonymous = demoRepository.addComment(
    '端末内の匿名投稿',
    null,
    storage,
  )
  assert.equal(anonymous.comments[0]?.nickname, null)
  assert.equal(
    demoRepository.getSnapshot(storage).comments[1]?.nickname,
    'デモ参加者',
  )
  assert.match(storage.getItem(DEMO_STORAGE_KEY) ?? '', /デモ参加者/)
})
