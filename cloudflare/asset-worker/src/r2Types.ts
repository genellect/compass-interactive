export type R2ObjectLike = {
  body?: ReadableStream
  etag: string
  httpEtag: string
  key: string
  range?: { length: number; offset: number }
  size: number
  arrayBuffer?: () => Promise<ArrayBuffer>
}

export type R2ListResultLike = {
  cursor?: string
  objects: R2ObjectLike[]
  truncated: boolean
}

export interface R2BucketLike {
  delete(key: string): Promise<void>
  get(
    key: string,
    options?: { range?: { length?: number; offset?: number; suffix?: number } },
  ): Promise<R2ObjectLike | null>
  head(key: string): Promise<R2ObjectLike | null>
  list(options: {
    cursor?: string
    limit?: number
    prefix: string
  }): Promise<R2ListResultLike>
  put(
    key: string,
    value: Uint8Array | string,
    options?: {
      httpMetadata?: Record<string, string>
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }
    },
  ): Promise<R2ObjectLike | null>
}
