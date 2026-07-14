import type {
  LiveSnapshot,
  LiveStateVersions,
} from '../repositories/supabaseLiveStateRepository'

export type LiveSnapshotForceOptions = {
  forceAll?: boolean
  forceCaption?: boolean
  forceComments?: boolean
  forceDisplay?: boolean
  forceLikes?: boolean
  forcePolls?: boolean
  forceSummaries?: boolean
}

export function getRequestedLiveStateVersions(
  current: LiveStateVersions,
  {
    forceAll = false,
    forceCaption = false,
    forceComments = false,
    forceDisplay = false,
    forceLikes = false,
    forcePolls = false,
    forceSummaries = false,
  }: LiveSnapshotForceOptions = {},
): LiveStateVersions {
  return {
    caption: forceAll || forceCaption ? null : current.caption,
    comments: forceAll || forceComments ? null : current.comments,
    display: forceAll || forceDisplay ? null : current.display,
    lecture: forceAll ? null : current.lecture,
    likes: forceAll || forceLikes ? null : current.likes,
    pdf: forceAll || forceDisplay ? null : current.pdf,
    polls: forceAll || forcePolls ? null : current.polls,
    state: forceAll ? null : current.state,
    summaries: forceAll || forceSummaries ? null : current.summaries,
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
