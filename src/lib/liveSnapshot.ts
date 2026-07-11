import type {
  LiveSnapshot,
  LiveStateVersions,
} from '../repositories/supabaseLiveStateRepository'

export type LiveSnapshotForceOptions = {
  forceAll?: boolean
  forceComments?: boolean
  forceDisplay?: boolean
  forceLikes?: boolean
  forcePolls?: boolean
}

export function getRequestedLiveStateVersions(
  current: LiveStateVersions,
  {
    forceAll = false,
    forceComments = false,
    forceDisplay = false,
    forceLikes = false,
    forcePolls = false,
  }: LiveSnapshotForceOptions = {},
): LiveStateVersions {
  return {
    comments: forceAll || forceComments ? null : current.comments,
    display: forceAll || forceDisplay ? null : current.display,
    likes: forceAll || forceLikes ? null : current.likes,
    polls: forceAll || forcePolls ? null : current.polls,
    state: forceAll ? null : current.state,
  }
}

export function advanceLiveStateVersions(
  previous: LiveStateVersions,
  snapshot: Pick<LiveSnapshot, 'comments' | 'versions'>,
): LiveStateVersions {
  return {
    ...snapshot.versions,
    comments:
      snapshot.comments?.mode === 'delta' && snapshot.comments.hasMore
        ? previous.comments
        : snapshot.versions.comments,
  }
}
