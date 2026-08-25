import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { DOCUMENT_ID_PATTERN, LECTURE_PUBLIC_ID_PATTERN } from '../constants.ts'
import type { ValidatedPdf } from '../pdf/validatePdf.ts'

export type StoredExtraction = {
  deleteAfter: string | null
  documentId: string
  documentVersion: string
  lecturePublicId: string
  pageCount: number
  pages: ValidatedPdf['pages']
  textAvailable?: boolean
  textCharCount: number
  textSha256: string
  textTruncated?: boolean
}

function assertSafeId(lecturePublicId: string, documentId: string) {
  if (
    !LECTURE_PUBLIC_ID_PATTERN.test(lecturePublicId) ||
    !DOCUMENT_ID_PATTERN.test(documentId)
  ) {
    throw new Error('Unsafe local extraction identifier.')
  }
}

function extractionPath(
  rootDirectory: string,
  lecturePublicId: string,
  documentId: string,
  documentVersion: string,
) {
  assertSafeId(lecturePublicId, documentId)
  if (!/^[0-9a-f]{64}$/.test(documentVersion)) {
    throw new Error('Unsafe local extraction version.')
  }
  return join(
    rootDirectory,
    lecturePublicId,
    `${documentId}-${documentVersion}.json`,
  )
}

export class LocalTextStore {
  readonly rootDirectory: string

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory
  }

  async save(input: {
    deleteAfter: string | null
    documentId: string
    lecturePublicId: string
    validatedPdf: ValidatedPdf
  }) {
    assertSafeId(input.lecturePublicId, input.documentId)
    const lectureDirectory = join(this.rootDirectory, input.lecturePublicId)
    await mkdir(lectureDirectory, { mode: 0o700, recursive: true })
    const finalPath = join(
      lectureDirectory,
      `${input.documentId}-${input.validatedPdf.pdfSha256}.json`,
    )
    const temporaryPath = `${finalPath}.tmp-${process.pid}`
    const payload: StoredExtraction = {
      deleteAfter: input.deleteAfter,
      documentId: input.documentId,
      documentVersion: input.validatedPdf.pdfSha256,
      lecturePublicId: input.lecturePublicId,
      pageCount: input.validatedPdf.pageCount,
      pages: input.validatedPdf.pages,
      textAvailable: input.validatedPdf.textAvailable,
      textCharCount: input.validatedPdf.textCharCount,
      textSha256: input.validatedPdf.textSha256,
      textTruncated: input.validatedPdf.textTruncated,
    }
    await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await rename(temporaryPath, finalPath)
    return finalPath
  }

  async load(input: {
    documentId: string
    documentVersion: string
    lecturePublicId: string
  }): Promise<StoredExtraction | null> {
    const filePath = extractionPath(
      this.rootDirectory,
      input.lecturePublicId,
      input.documentId,
      input.documentVersion,
    )
    let stored: StoredExtraction
    try {
      stored = JSON.parse(await readFile(filePath, 'utf8')) as StoredExtraction
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const textAvailable = stored.textAvailable ?? stored.textCharCount > 0
    const textTruncated = stored.textTruncated === true
    if (
      stored.lecturePublicId !== input.lecturePublicId ||
      stored.documentId !== input.documentId ||
      stored.documentVersion !== input.documentVersion ||
      stored.textSha256 === '' ||
      !/^[0-9a-f]{64}$/.test(stored.textSha256) ||
      stored.pages.length !== stored.pageCount ||
      stored.textCharCount < 0 ||
      stored.textCharCount > 20_000 ||
      (!textAvailable && stored.textCharCount !== 0) ||
      (textTruncated && stored.textCharCount !== 20_000)
    ) {
      throw new Error('Local extraction identity is inconsistent.')
    }
    return stored
  }

  async cleanupDue(now = new Date()) {
    await mkdir(this.rootDirectory, { mode: 0o700, recursive: true })
    let deleted = 0
    const lectureDirectories = await readdir(this.rootDirectory, {
      withFileTypes: true,
    })
    for (const lectureDirectory of lectureDirectories) {
      if (!lectureDirectory.isDirectory()) continue
      const directoryPath = join(this.rootDirectory, lectureDirectory.name)
      for (const entry of await readdir(directoryPath, {
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const filePath = join(directoryPath, entry.name)
        let stored: StoredExtraction
        try {
          stored = JSON.parse(
            await readFile(filePath, 'utf8'),
          ) as StoredExtraction
        } catch {
          continue
        }
        if (
          stored.deleteAfter &&
          Date.parse(stored.deleteAfter) <= now.getTime()
        ) {
          await rm(filePath, { force: true })
          deleted += 1
        }
      }
    }
    return deleted
  }

  async applyRetention(input: {
    deleteAfter: string
    documentId: string
    documentVersion: string
    lecturePublicId: string
  }) {
    const timestamp = Date.parse(input.deleteAfter)
    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString() !== input.deleteAfter
    ) {
      throw new Error('Local extraction retention time is invalid.')
    }
    const filePath = extractionPath(
      this.rootDirectory,
      input.lecturePublicId,
      input.documentId,
      input.documentVersion,
    )
    let stored: StoredExtraction
    try {
      stored = JSON.parse(await readFile(filePath, 'utf8')) as StoredExtraction
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    if (
      stored.lecturePublicId !== input.lecturePublicId ||
      stored.documentId !== input.documentId ||
      stored.documentVersion !== input.documentVersion
    ) {
      throw new Error('Local extraction identity is inconsistent.')
    }
    if (stored.deleteAfter === input.deleteAfter) return false
    const temporaryPath = `${filePath}.retention-${process.pid}`
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ ...stored, deleteAfter: input.deleteAfter })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    )
    await rename(temporaryPath, filePath)
    return true
  }
}
