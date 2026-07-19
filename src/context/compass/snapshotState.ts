import type { LiveStateVersions } from '../../repositories/supabaseLiveStateRepository'

export function createEmptyLiveStateVersions(): LiveStateVersions {
  return {
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
  }
}
