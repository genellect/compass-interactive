export type StoredObject = {
  bytes: Uint8Array
  contentType: string | null
  etag: string
  metadata: Record<string, string>
}

export type StoredObjectHead = Omit<StoredObject, 'bytes'> & { size: number }

export type PutObjectOptions = {
  cacheControl?: string
  contentDisposition?: string
  contentType: string
  ifMatch?: string
  ifNoneMatch?: '*'
  metadata?: Record<string, string>
}

export class ConditionalObjectWriteError extends Error {}

export interface PrivateObjectStore {
  delete(key: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  head(key: string): Promise<StoredObjectHead | null>
  put(
    key: string,
    bytes: Uint8Array,
    options: PutObjectOptions,
  ): Promise<StoredObjectHead>
}
