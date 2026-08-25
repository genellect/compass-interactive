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

export type LiveSnapshotFreshness = {
  caption: boolean
  comments: boolean
  display: boolean
  lecture: boolean
  likes: boolean
  metrics: boolean
  polls: boolean
  summaries: boolean
}

export type LiveSnapshotFenceState = {
  appliedSequence: number
  appliedVersions: LiveStateVersions
  requestSequence: number
  requestedVersions: LiveStateVersions
}

export function createLiveSnapshotFenceState(): LiveSnapshotFenceState {
  const emptyVersions = (): LiveStateVersions => ({
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

  return {
    appliedSequence: 0,
    appliedVersions: emptyVersions(),
    requestSequence: 0,
    requestedVersions: emptyVersions(),
  }
}

export function isLiveStateVersionCurrent(
  appliedVersion: number | null,
  incomingVersion: number | null,
) {
  if (incomingVersion === null) return appliedVersion === null
  return appliedVersion === null || incomingVersion >= appliedVersion
}

export function mergeLiveStateVersions(
  previous: LiveStateVersions,
  incoming: LiveStateVersions,
): LiveStateVersions {
  return Object.fromEntries(
    (Object.keys(previous) as Array<keyof LiveStateVersions>).map((key) => {
      const previousVersion = previous[key]
      const incomingVersion = incoming[key]
      return [
        key,
        previousVersion === null
          ? incomingVersion
          : incomingVersion === null
            ? previousVersion
            : Math.max(previousVersion, incomingVersion),
      ]
    }),
  ) as LiveStateVersions
}

export function getLiveSnapshotFreshness(
  applied: LiveStateVersions,
  snapshot: Pick<LiveSnapshot, 'contractVersion' | 'versions'>,
): LiveSnapshotFreshness {
  const isCurrent = (key: keyof LiveStateVersions) =>
    isLiveStateVersionCurrent(applied[key], snapshot.versions[key])

  return {
    caption: isCurrent('caption'),
    comments: isCurrent('comments'),
    display: isCurrent(snapshot.contractVersion === 1 ? 'display' : 'pdf'),
    lecture: isCurrent('lecture'),
    likes: isCurrent('likes'),
    metrics: isCurrent('metrics'),
    polls: isCurrent('polls'),
    summaries: isCurrent('summaries'),
  }
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
    metrics: forceAll ? null : current.metrics,
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
  const next = Object.fromEntries(
    (Object.keys(previous) as Array<keyof LiveStateVersions>).map((key) => {
      const previousVersion = previous[key]
      const incomingVersion = snapshot.versions[key]
      return [
        key,
        incomingVersion === null || previousVersion === null
          ? incomingVersion
          : Math.max(previousVersion, incomingVersion),
      ]
    }),
  ) as LiveStateVersions
  next.comments =
    snapshot.comments?.mode === 'delta' && snapshot.comments.hasMore
      ? previous.comments
      : next.comments
  return next
}
