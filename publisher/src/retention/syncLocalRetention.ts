import { LocalTextStore } from '../storage/localTextStore.ts'
import {
  DOCUMENT_ID_PATTERN,
  LECTURE_PUBLIC_ID_PATTERN,
  SHA256_PATTERN,
} from '../constants.ts'

type RetentionItem = {
  archiveExpiresAt: string
  deleteAfter: string
  documentId: string
  documentVersion: string
  lecturePublicId: string
}

function parseFeed(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Retention feed is invalid.')
  }
  const feed = value as Record<string, unknown>
  if (
    feed.contractVersion !== 1 ||
    typeof feed.hasMore !== 'boolean' ||
    !Number.isInteger(feed.nextOffset) ||
    !Array.isArray(feed.items)
  ) {
    throw new Error('Retention feed header is invalid.')
  }
  return {
    hasMore: feed.hasMore,
    items: feed.items as RetentionItem[],
    nextOffset: Number(feed.nextOffset),
  }
}

export async function syncLocalRetention(input: {
  feedUrl: string
  fetcher?: typeof fetch
  secret: string
  textStore: LocalTextStore
}) {
  if (new TextEncoder().encode(input.secret).byteLength < 32) {
    throw new Error('Retention synchronization secret must contain 32 bytes.')
  }
  const endpoint = new URL(input.feedUrl)
  if (
    endpoint.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost'].includes(endpoint.hostname)
  ) {
    throw new Error('Retention feed must use HTTPS.')
  }
  const fetcher = input.fetcher ?? fetch
  let offset = 0
  let updated = 0
  for (let page = 0; page < 200; page += 1) {
    endpoint.searchParams.set('offset', String(offset))
    const response = await fetcher(endpoint, {
      headers: { Authorization: `Bearer ${input.secret}` },
    })
    if (!response.ok) {
      throw new Error(`Retention feed failed (${response.status}).`)
    }
    const feed = parseFeed(await response.json())
    for (const item of feed.items) {
      const archiveTimestamp = Date.parse(item.archiveExpiresAt)
      const deleteTimestamp = Date.parse(item.deleteAfter)
      if (
        typeof item.lecturePublicId !== 'string' ||
        !LECTURE_PUBLIC_ID_PATTERN.test(item.lecturePublicId) ||
        typeof item.documentId !== 'string' ||
        !DOCUMENT_ID_PATTERN.test(item.documentId) ||
        typeof item.documentVersion !== 'string' ||
        !SHA256_PATTERN.test(item.documentVersion) ||
        typeof item.archiveExpiresAt !== 'string' ||
        !Number.isFinite(archiveTimestamp) ||
        new Date(archiveTimestamp).toISOString() !== item.archiveExpiresAt ||
        typeof item.deleteAfter !== 'string' ||
        !Number.isFinite(deleteTimestamp) ||
        new Date(deleteTimestamp).toISOString() !== item.deleteAfter ||
        deleteTimestamp !== archiveTimestamp + 7 * 24 * 60 * 60 * 1000
      ) {
        throw new Error('Retention feed item is invalid.')
      }
      if (await input.textStore.applyRetention(item)) updated += 1
    }
    if (!feed.hasMore) return updated
    if (feed.nextOffset <= offset) {
      throw new Error('Retention feed pagination did not advance.')
    }
    offset = feed.nextOffset
  }
  throw new Error('Retention feed exceeded the page safety limit.')
}
