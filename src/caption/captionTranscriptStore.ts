import type { CompletedCaptionSegment } from './captionWindow'

const DATABASE_NAME = 'compass-interactive-private-transcripts'
const DATABASE_VERSION = 1
const STORE_NAME = 'completed-segments'

function openTranscriptDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: ['lectureSessionId', 'itemId'],
        })
        store.createIndex('lecture-sequence', ['lectureSessionId', 'sequence'])
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function transactStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openTranscriptDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = action(transaction.objectStore(STORE_NAME))
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function saveCompletedCaptionSegment(
  segment: CompletedCaptionSegment,
) {
  await transactStore('readwrite', (store) => store.put(segment))
}

export async function listCompletedCaptionSegments(lectureSessionId: string) {
  const all = await transactStore<CompletedCaptionSegment[]>(
    'readonly',
    (store) => store.getAll(),
  )
  return all
    .filter((segment) => segment.lectureSessionId === lectureSessionId)
    .sort((left, right) => left.sequence - right.sequence)
}

export async function deleteCompletedCaptionSegments(lectureSessionId: string) {
  const segments = await listCompletedCaptionSegments(lectureSessionId)
  const database = await openTranscriptDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      for (const segment of segments) {
        store.delete([lectureSessionId, segment.itemId])
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function deleteExpiredCompletedCaptionSegments(
  nowMs = Date.now(),
  maxAgeDays = 30,
) {
  const all = await transactStore<CompletedCaptionSegment[]>(
    'readonly',
    (store) => store.getAll(),
  )
  const cutoff = nowMs - maxAgeDays * 24 * 60 * 60 * 1_000
  const expired = all.filter((segment) => {
    const completedAt = Date.parse(segment.completedAt)
    return !Number.isFinite(completedAt) || completedAt < cutoff
  })
  if (expired.length === 0) return 0

  const database = await openTranscriptDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      for (const segment of expired) {
        store.delete([segment.lectureSessionId, segment.itemId])
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
  return expired.length
}

export function createTranscriptExport(
  segments: CompletedCaptionSegment[],
  format: 'jsonl' | 'txt',
) {
  const content =
    format === 'jsonl'
      ? segments.map((segment) => JSON.stringify(segment)).join('\n')
      : segments
          .map(
            (segment) =>
              `[${segment.startedAt} - ${segment.completedAt}] ${segment.text}`,
          )
          .join('\n')
  return new Blob([content], {
    type: format === 'jsonl' ? 'application/x-ndjson' : 'text/plain',
  })
}
