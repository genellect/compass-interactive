import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  advanceLiveStateVersions,
  getRequestedLiveStateVersions,
} from '../src/lib/liveSnapshot.ts'
import {
  getLiveSyncBackoffDelay,
  getLiveSyncJitter,
} from '../src/lib/liveSync.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

const current = { comments: 5, display: 2, likes: 3, polls: 4, state: 9 }
assert.deepEqual(getRequestedLiveStateVersions(current), current)
assert.deepEqual(getRequestedLiveStateVersions(current, { forceComments: true }), {
  ...current,
  comments: null,
})
assert.deepEqual(getRequestedLiveStateVersions(current, { forceAll: true }), {
  comments: null,
  display: null,
  likes: null,
  polls: null,
  state: null,
})

const received = { comments: 8, display: 6, likes: 7, polls: 9, state: 12 }
assert.deepEqual(
  advanceLiveStateVersions(current, {
    comments: { hasMore: true, hasOlder: false, items: [], mode: 'delta' },
    versions: received,
  }),
  { ...received, comments: current.comments },
  'A truncated delta keeps the old version so the next request drains the gap.',
)
assert.deepEqual(
  advanceLiveStateVersions(current, {
    comments: { hasMore: false, hasOlder: false, items: [], mode: 'delta' },
    versions: received,
  }),
  received,
)

assert.equal(getLiveSyncBackoffDelay({ failureCount: 0 }), 5_000)
assert.equal(getLiveSyncBackoffDelay({ failureCount: 1 }), 10_000)
assert.equal(getLiveSyncBackoffDelay({ failureCount: 2 }), 20_000)
assert.equal(getLiveSyncBackoffDelay({ failureCount: 3 }), 30_000)
assert.equal(getLiveSyncBackoffDelay({ failureCount: 99 }), 30_000)
assert.equal(getLiveSyncJitter(-1), 0)
assert.equal(getLiveSyncJitter(1), 1_000)

const context = read('src/context/CompassStateContext.tsx')
const displayPage = read('src/pages/DisplayPage.tsx')
const adminPage = read('src/pages/AdminPage.tsx')
const commentsRepository = read('src/repositories/supabaseCommentRepository.ts')
const pollsRepository = read('src/repositories/supabasePollRepository.ts')
const migration = read('supabase/migrations/20260711020445_live_state_integration.sql')

assert.match(context, /await refreshLiveSnapshot\(\)/)
assert.doesNotMatch(context, /Promise\.allSettled/)
assert.doesNotMatch(displayPage, /useAdaptiveLiveSync|supabaseDisplayStateRepository/)
assert.doesNotMatch(adminPage, /useAdaptiveLiveSync|supabaseDisplayStateRepository\./)
assert.doesNotMatch(
  commentsRepository.match(/async createVisibleComment[\s\S]*?\n  },/)?.[0] ?? '',
  /ensureAnonymousParticipant/,
)
assert.doesNotMatch(
  commentsRepository.match(/async addCommentLike[\s\S]*?\n  },/)?.[0] ?? '',
  /ensureAnonymousParticipant/,
)
assert.doesNotMatch(pollsRepository, /ensureAnonymousParticipant|participants/)
assert.match(commentsRepository, /onConnected\?\.\(\)/)

for (const objectName of [
  'lecture_live_state',
  'comment_like_totals',
  'poll_option_totals',
  'get_lecture_live_snapshot',
]) {
  assert.match(migration, new RegExp(`public\\.${objectName}\\b`))
}
assert.doesNotMatch(migration, /alter publication supabase_realtime add table/)

console.log('Milestone 2 live-state unit and static checks passed.')
