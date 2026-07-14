import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import {
  ConditionalObjectWriteError,
  type PrivateObjectStore,
  type PutObjectOptions,
} from '../cloudflare/objectStore.ts'

type FileMetadata = {
  contentType: string
  etag: string
  metadata: Record<string, string>
}

export class FileObjectStore implements PrivateObjectStore {
  readonly rootDirectory: string

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory
  }

  #path(key: string) {
    if (
      !key ||
      key.includes('..') ||
      key.startsWith('/') ||
      key.includes('\\')
    ) {
      throw new Error('Unsafe object key.')
    }
    const root = resolve(this.rootDirectory)
    const target = resolve(root, key)
    if (!target.startsWith(`${root}${sep}`))
      throw new Error('Unsafe object key.')
    return target
  }

  async delete(key: string) {
    const path = this.#path(key)
    await rm(path, { force: true })
    await rm(`${path}.meta.json`, { force: true })
  }

  async get(key: string) {
    const path = this.#path(key)
    try {
      const [bytes, metadata] = await Promise.all([
        readFile(path),
        readFile(`${path}.meta.json`, 'utf8').then(
          (value) => JSON.parse(value) as FileMetadata,
        ),
      ])
      return { bytes, ...metadata }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async head(key: string) {
    const path = this.#path(key)
    try {
      const [details, metadata] = await Promise.all([
        stat(path),
        readFile(`${path}.meta.json`, 'utf8').then(
          (value) => JSON.parse(value) as FileMetadata,
        ),
      ])
      return { ...metadata, size: details.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async put(key: string, bytes: Uint8Array, options: PutObjectOptions) {
    const path = this.#path(key)
    const existing = await this.head(key)
    if (
      (options.ifNoneMatch === '*' && existing) ||
      (options.ifMatch !== undefined && existing?.etag !== options.ifMatch)
    ) {
      throw new ConditionalObjectWriteError('Conditional file write failed.')
    }
    await mkdir(dirname(path), { mode: 0o700, recursive: true })
    const etag = createHash('sha256').update(bytes).digest('hex')
    const metadata: FileMetadata = {
      contentType: options.contentType,
      etag,
      metadata: options.metadata ?? {},
    }
    const suffix = `.tmp-${process.pid}-${randomSuffix()}`
    await writeFile(`${path}${suffix}`, bytes, { flag: 'wx', mode: 0o600 })
    await writeFile(
      `${path}.meta.json${suffix}`,
      `${JSON.stringify(metadata)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    )
    await rename(`${path}${suffix}`, path)
    await rename(`${path}.meta.json${suffix}`, `${path}.meta.json`)
    return { ...metadata, size: bytes.byteLength }
  }
}

function randomSuffix() {
  return createHash('sha256')
    .update(`${process.hrtime.bigint()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 12)
}
