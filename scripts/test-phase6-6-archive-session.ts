import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearLectureArchiveResumeCode,
  persistLectureArchiveResumeCode,
  restoreLectureArchiveResumeCode,
} from '../src/archive/archiveSessionStorage.ts'
import {
  RequestDeadlineError,
  waitForPromiseWithDeadline,
} from '../src/lib/asyncDeadline.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

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

test('stores only the normalized lecture code for a safe archive refresh', () => {
  const storage = new MemoryStorage()
  Object.assign(globalThis, { window: { sessionStorage: storage } })
  persistLectureArchiveResumeCode(' 285463 ')
  assert.equal(restoreLectureArchiveResumeCode(), '285463')
  const serialized = [...storage.values.values()].join('')
  assert.doesNotMatch(serialized, /token|archiveAccess|comments|pdf/i)
})

test('preserves legacy codes during the expand-first compatibility period', () => {
  const storage = new MemoryStorage()
  Object.assign(globalThis, { window: { sessionStorage: storage } })
  persistLectureArchiveResumeCode('jc-2026')
  assert.equal(restoreLectureArchiveResumeCode(), 'JC-2026')
})

test('rejects invalid stored values and clears the current tab', () => {
  const storage = new MemoryStorage()
  Object.assign(globalThis, { window: { sessionStorage: storage } })
  persistLectureArchiveResumeCode('285463')
  const key = [...storage.values.keys()][0]
  assert.ok(key)
  storage.setItem(key, '../invalid')
  assert.equal(restoreLectureArchiveResumeCode(), null)
  assert.equal(storage.values.size, 0)
  clearLectureArchiveResumeCode()
})

test('returns a completed request before its deadline', async () => {
  await assert.doesNotReject(async () => {
    assert.equal(
      await waitForPromiseWithDeadline(
        Promise.resolve('ready'),
        1_000,
        'archive lookup',
      ),
      'ready',
    )
  })
})

test('bounds the caller wait without duplicating or cancelling the request', async () => {
  let resolveRequest: (value: string) => void = () => undefined
  const request = new Promise<string>((resolve) => {
    resolveRequest = resolve
  })

  await assert.rejects(
    waitForPromiseWithDeadline(request, 10, 'archive lookup'),
    (error: unknown) =>
      error instanceof RequestDeadlineError &&
      error.operation === 'archive lookup' &&
      error.timeoutMs === 10,
  )

  resolveRequest('late but singular')
  assert.equal(await request, 'late but singular')
})
