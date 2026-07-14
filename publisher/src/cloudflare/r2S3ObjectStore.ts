import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  ConditionalObjectWriteError,
  type PrivateObjectStore,
  type PutObjectOptions,
  type StoredObjectHead,
} from './objectStore.ts'

export type R2PublisherConfiguration = {
  accessKeyId: string
  accountId: string
  bucket: string
  endpoint?: string
  secretAccessKey: string
}

function normalizeEtag(etag: string | undefined) {
  return etag?.replace(/^"|"$/g, '') ?? ''
}

function isPreconditionFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    $metadata?: { httpStatusCode?: number }
    name?: string
  }
  return (
    candidate.$metadata?.httpStatusCode === 412 ||
    candidate.name === 'PreconditionFailed'
  )
}

export class R2S3ObjectStore implements PrivateObjectStore {
  readonly #bucket: string
  readonly #client: S3Client

  constructor(configuration: R2PublisherConfiguration) {
    this.#bucket = configuration.bucket
    this.#client = new S3Client({
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
      endpoint:
        configuration.endpoint ??
        `https://${configuration.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      region: 'auto',
    })
  }

  async delete(key: string) {
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }),
    )
  }

  async get(key: string) {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      )
      if (!response.Body) return null
      return {
        bytes: await response.Body.transformToByteArray(),
        contentType: response.ContentType ?? null,
        etag: normalizeEtag(response.ETag),
        metadata: response.Metadata ?? {},
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      ) {
        return null
      }
      throw error
    }
  }

  async head(key: string): Promise<StoredObjectHead | null> {
    try {
      const response = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      )
      return {
        contentType: response.ContentType ?? null,
        etag: normalizeEtag(response.ETag),
        metadata: response.Metadata ?? {},
        size: response.ContentLength ?? 0,
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      ) {
        return null
      }
      throw error
    }
  }

  async put(key: string, bytes: Uint8Array, options: PutObjectOptions) {
    try {
      const response = await this.#client.send(
        new PutObjectCommand({
          Body: bytes,
          Bucket: this.#bucket,
          CacheControl: options.cacheControl,
          ContentDisposition: options.contentDisposition,
          ContentLength: bytes.byteLength,
          ContentType: options.contentType,
          IfMatch: options.ifMatch,
          IfNoneMatch: options.ifNoneMatch,
          Key: key,
          Metadata: options.metadata,
        }),
      )
      return {
        contentType: options.contentType,
        etag: normalizeEtag(response.ETag),
        metadata: options.metadata ?? {},
        size: bytes.byteLength,
      }
    } catch (error) {
      if (isPreconditionFailure(error)) {
        throw new ConditionalObjectWriteError('Conditional R2 write failed.')
      }
      throw error
    }
  }
}

export function loadR2PublisherConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): R2PublisherConfiguration {
  const required = {
    accessKeyId: environment.COMPASS_R2_ACCESS_KEY_ID,
    accountId: environment.COMPASS_R2_ACCOUNT_ID,
    bucket: environment.COMPASS_R2_BUCKET,
    secretAccessKey: environment.COMPASS_R2_SECRET_ACCESS_KEY,
  }
  if (Object.values(required).some((value) => !value)) {
    throw new Error(
      'R2 credentials must be injected into the Publisher process environment.',
    )
  }
  return {
    accessKeyId: required.accessKeyId!,
    accountId: required.accountId!,
    bucket: required.bucket!,
    endpoint: environment.COMPASS_R2_ENDPOINT,
    secretAccessKey: required.secretAccessKey!,
  }
}
