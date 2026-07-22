import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  advanceLiveStateVersions,
  getRequestedLiveStateVersions,
} from '../src/lib/liveSnapshot.ts'
import {
  getHiddenLiveSyncDelay,
  getLiveSyncBackoffDelay,
  getLiveSyncJitter,
  normalizeLiveSyncPathname,
} from '../src/lib/liveSync.ts'
import {
  createOptimisticComment,
  mergeInitialCommentsWithPending,
  rollbackOptimisticComment,
  settleOptimisticComment,
} from '../src/lib/optimisticComments.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

const current = {
  caption: 1,
  comments: 5,
  display: 2,
  lecture: 8,
  likes: 3,
  metrics: 10,
  pdf: 6,
  polls: 4,
  state: 9,
  summaries: 7,
}
assert.deepEqual(getRequestedLiveStateVersions(current), current)
assert.deepEqual(
  getRequestedLiveStateVersions(current, { forceComments: true }),
  {
    ...current,
    comments: null,
  },
)
assert.deepEqual(getRequestedLiveStateVersions(current, { forceAll: true }), {
  caption: null,
  comments: null,
  display: null,
  lecture: null,
  likes: null,
  metrics: null,
  pdf: null,
  polls: null,
  state: null,
  summaries: null,
})

const received = {
  caption: 2,
  comments: 8,
  display: null,
  lecture: 9,
  likes: 7,
  metrics: 11,
  pdf: 8,
  polls: 9,
  state: null,
  summaries: 8,
}
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
assert.equal(
  getHiddenLiveSyncDelay({ elapsedHiddenMs: 0, hiddenSyncCompleted: false }),
  30_000,
)
assert.equal(
  getHiddenLiveSyncDelay({
    elapsedHiddenMs: 30_000,
    hiddenSyncCompleted: true,
  }),
  null,
)
assert.equal(
  getHiddenLiveSyncDelay({
    elapsedHiddenMs: 60_000,
    hiddenSyncCompleted: false,
  }),
  null,
)
assert.equal(normalizeLiveSyncPathname('/display'), '/display')
assert.equal(normalizeLiveSyncPathname('/display/'), '/display')
assert.equal(normalizeLiveSyncPathname('/lecture///'), '/lecture')
assert.equal(normalizeLiveSyncPathname('/'), '/')

const optimistic = createOptimisticComment({
  body: '  queued question  ',
  createdAt: '2026-07-14T00:00:01.000Z',
  id: 'optimistic-test',
  lectureId: 'lecture-1',
  nickname: '質問係',
  participantId: 'participant-1',
})
assert.equal(optimistic.body, 'queued question')
assert.equal(optimistic.nickname, '質問係')
assert.equal(optimistic.isPending, true)
assert.deepEqual(
  mergeInitialCommentsWithPending([optimistic], []),
  [optimistic],
  'An in-flight optimistic comment survives an initial snapshot refresh.',
)
const saved = { ...optimistic, id: 'saved-comment', isPending: undefined }
assert.deepEqual(settleOptimisticComment([optimistic], optimistic.id, saved), [
  saved,
])
assert.deepEqual(rollbackOptimisticComment([optimistic], optimistic.id), [])

const context = read('src/context/CompassStateContext.tsx')
const displayPage = read('src/pages/DisplayPage.tsx')
const adminPage = read('src/pages/AdminPage.tsx')
const adaptiveSyncHook = read('src/hooks/useAdaptiveLiveSync.ts')
const commentsRepository = read('src/repositories/supabaseCommentRepository.ts')
const liveStateRepository = read(
  'src/repositories/supabaseLiveStateRepository.ts',
)
const liveStateMappers = read('src/repositories/supabase/liveStateMappers.ts')
const liveStateImplementation = liveStateRepository + liveStateMappers
const learningSupport = read(
  'src/components/LearningSupport/LearningSupport.tsx',
)
const pollsRepository = read('src/repositories/supabasePollRepository.ts')
const migration = read(
  'supabase/migrations/20260711020445_live_state_integration.sql',
)
const phase0Migration = read(
  'supabase/migrations/20260713142227_phase0_auth_hardening.sql',
)

assert.match(context, /await refreshLiveSnapshot\(\)/)
assert.match(
  context,
  /void refreshLiveSnapshot\(\{ forceAll: true, showLoading: true \}\)\.catch\(/,
  'The initial live snapshot must not leak transient network failures as unhandled browser errors.',
)
assert.doesNotMatch(context, /Promise\.allSettled/)
assert.equal(
  context.match(/supabaseLiveStateRepository\.getSnapshot/g)?.length,
  1,
  'All five-second live data must use one snapshot repository call.',
)
assert.equal(
  context.match(/useAdaptiveLiveSync\(/g)?.length,
  1,
  'Only one adaptive live-sync loop may be mounted.',
)
assert.match(context, /liveSnapshotInFlightRef/)
assert.match(context, /canShareInFlightRequest/)
assert.match(adaptiveSyncHook, /if \(disposed \|\| running\)/)
assert.match(adaptiveSyncHook, /BACKGROUND_LIVE_SYNC_INTERVAL_MS/)
assert.match(adaptiveSyncHook, /hiddenSyncCompleted/)
assert.match(adaptiveSyncHook, /getHiddenLiveSyncDelay/)
assert.match(adaptiveSyncHook, /visibilityState === 'visible'/)
assert.doesNotMatch(
  context,
  /IDLE_SYNC_TIMEOUT_MS|setSessionSyncPauseReason\('idle'\)/,
)
assert.doesNotMatch(
  displayPage,
  /useAdaptiveLiveSync|supabaseDisplayStateRepository/,
)
assert.doesNotMatch(
  adminPage,
  /useAdaptiveLiveSync|supabaseDisplayStateRepository\./,
)
assert.doesNotMatch(learningSupport, /supabase|fetch\(|\.rpc\(/i)
assert.doesNotMatch(
  context,
  /ensureAnonymousParticipant|subscribeToVisibleCommentInserts/,
)
assert.doesNotMatch(
  commentsRepository.match(/async createVisibleComment[\s\S]*?\n  },/)?.[0] ??
    '',
  /ensureAnonymousParticipant/,
)
assert.doesNotMatch(
  commentsRepository.match(/async addCommentLike[\s\S]*?\n  },/)?.[0] ?? '',
  /ensureAnonymousParticipant/,
)
assert.doesNotMatch(pollsRepository, /ensureAnonymousParticipant|participants/)
assert.doesNotMatch(commentsRepository, /\.channel\(|postgres_changes/)
assert.doesNotMatch(commentsRepository, /from\('participants'\)/)
assert.doesNotMatch(liveStateImplementation, /target_participant_id/)
assert.match(liveStateImplementation, /current_participant_id/)
assert.match(liveStateRepository, /get_lecture_public_snapshot_v2/)
assert.match(liveStateRepository, /get_lecture_participant_state_v2/)
assert.match(liveStateRepository, /get_lecture_comment_history_v2/)
assert.match(context, /mergeInitialCommentsWithPending/)
assert.match(context, /rollbackOptimisticComment/)

for (const objectName of [
  'lecture_live_state',
  'comment_like_totals',
  'poll_option_totals',
  'get_lecture_live_snapshot',
]) {
  assert.match(migration, new RegExp(`public\\.${objectName}\\b`))
}
assert.doesNotMatch(migration, /alter publication supabase_realtime add table/)
assert.match(
  phase0Migration,
  /alter publication supabase_realtime drop table public\.comments/,
)

console.log('Milestone 2 live-state unit and static checks passed.')
