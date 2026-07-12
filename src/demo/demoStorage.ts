import { demoSeedComments } from './demoSeedData.ts'
import type { LiveComment, PollResponse } from '../types/index.ts'

export const DEMO_STORAGE_KEY = 'compass-interactive:demo:v1'
export const DEMO_SCHEMA_VERSION = 2 as const

export type DemoLectureState = {
  schemaVersion: typeof DEMO_SCHEMA_VERSION
  participantId: string
  comments: LiveComment[]
  pollResponses: PollResponse[]
  createdAt: string
  updatedAt: string
}

export type DemoStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

function getBrowserStorage(): DemoStorage {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    throw new Error('localStorage is unavailable.')
  }

  return window.localStorage
}

function cloneState(state: DemoLectureState): DemoLectureState {
  return JSON.parse(JSON.stringify(state)) as DemoLectureState
}

function createParticipantId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isDemoLectureState(value: unknown): value is DemoLectureState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const state = value as Partial<DemoLectureState>
  return (
    state.schemaVersion === DEMO_SCHEMA_VERSION &&
    typeof state.participantId === 'string' &&
    state.participantId.length > 0 &&
    Array.isArray(state.comments) &&
    Array.isArray(state.pollResponses) &&
    typeof state.createdAt === 'string' &&
    typeof state.updatedAt === 'string'
  )
}

export function createInitialDemoState(
  now = new Date().toISOString(),
): DemoLectureState {
  return {
    schemaVersion: DEMO_SCHEMA_VERSION,
    participantId: createParticipantId(),
    comments: demoSeedComments.map((comment) => ({
      ...comment,
      likedByParticipantIds: [...comment.likedByParticipantIds],
    })),
    pollResponses: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function saveDemoState(
  state: DemoLectureState,
  storage: DemoStorage = getBrowserStorage(),
) {
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state))
  return cloneState(state)
}

export function loadDemoState(
  storage: DemoStorage = getBrowserStorage(),
): DemoLectureState {
  const serialized = storage.getItem(DEMO_STORAGE_KEY)

  if (serialized) {
    try {
      const parsed = JSON.parse(serialized) as unknown
      if (isDemoLectureState(parsed)) {
        return cloneState(parsed)
      }
    } catch {
      // Replace malformed or obsolete demo data with the versioned seed state.
    }
  }

  return saveDemoState(createInitialDemoState(), storage)
}

export function resetDemoState(
  storage: DemoStorage = getBrowserStorage(),
): DemoLectureState {
  storage.removeItem(DEMO_STORAGE_KEY)
  return saveDemoState(createInitialDemoState(), storage)
}

export function subscribeToDemoState(onChange: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  function handleStorage(event: StorageEvent) {
    if (event.key === DEMO_STORAGE_KEY) {
      onChange()
    }
  }

  window.addEventListener('storage', handleStorage)
  return () => window.removeEventListener('storage', handleStorage)
}
